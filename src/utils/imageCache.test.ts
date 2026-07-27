/**
 * imageCache 测试
 *
 * 重点验证：
 * 1. 命中缓存：返回同一 Promise 引用并 bump 到 LRU 队尾
 * 2. 未命中：调用 electronAPI.file.readDataURL
 * 3. 读取失败：写入错误缓存，TTL 内重读直接 reject 不触发 IPC
 * 4. TTL 过期后重试
 * 5. LRU 淘汰：超过 IMAGE_CACHE_MAX_ENTRIES 时丢弃队首
 * 6. clearImageCache / clearImageErrorCache 支持单个/全部清理
 * 7. electron bridge 不可用时 reject
 */
import { readImageDataUrl, clearImageCache, clearImageErrorCache } from '@/utils/imageCache';
import { IMAGE_CACHE_MAX_ENTRIES, IMAGE_ERROR_CACHE_TTL_MS } from '@/constants/config';

const electronAPI = window.electronAPI!;
const readDataURLMock = electronAPI.file.readDataURL as unknown as ReturnType<typeof vi.fn>;

describe('imageCache', () => {
  beforeEach(() => {
    clearImageCache();
    clearImageErrorCache();
    readDataURLMock.mockReset();
    readDataURLMock.mockRejectedValue(new Error('not implemented in test'));
  });

  describe('readImageDataUrl 基础语义', () => {
    it('未命中 → 调用 electronAPI.file.readDataURL 并返回 dataURL', async () => {
      readDataURLMock.mockResolvedValueOnce('data:image/png;base64,AAA');
      const result = await readImageDataUrl('/path/a.png');
      expect(result).toBe('data:image/png;base64,AAA');
      expect(readDataURLMock).toHaveBeenCalledWith('/path/a.png');
    });

    it('命中缓存 → 返回同一 Promise 引用，不再次调用 IPC', async () => {
      readDataURLMock.mockResolvedValueOnce('data:image/png;base64,BBB');
      const p1 = readImageDataUrl('/path/b.png');
      const p2 = readImageDataUrl('/path/b.png');
      // 同一引用（缓存层返回的是同一 Promise）
      expect(p2).toBe(p1);
      await Promise.all([p1, p2]);
      // IPC 只被调用一次（第二次命中缓存）
      expect(readDataURLMock).toHaveBeenCalledTimes(1);
    });

    it('不同路径分别调用 IPC', async () => {
      readDataURLMock.mockResolvedValueOnce('data1');
      readDataURLMock.mockResolvedValueOnce('data2');
      const r1 = await readImageDataUrl('/path/1.png');
      const r2 = await readImageDataUrl('/path/2.png');
      expect(r1).toBe('data1');
      expect(r2).toBe('data2');
      expect(readDataURLMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('LRU 行为', () => {
    it('命中时 bump 到队尾，避免被淘汰', async () => {
      // 注：IMAGE_CACHE_MAX_ENTRIES 默认 64，构造 64+1 条目淘汰队首
      // 先填满缓存，再 bump 第一条，然后插入新条目，验证被淘汰的不是第一条
      for (let i = 0; i < IMAGE_CACHE_MAX_ENTRIES; i++) {
        readDataURLMock.mockResolvedValueOnce(`data${i}`);
      }
      // 触发所有读取，让缓存写入
      const paths: string[] = [];
      for (let i = 0; i < IMAGE_CACHE_MAX_ENTRIES; i++) {
        paths.push(`/p/${i}.png`);
      }
      await Promise.all(paths.map(p => readImageDataUrl(p)));

      // bump 第 0 条
      readDataURLMock.mockClear();
      await readImageDataUrl('/p/0.png');
      expect(readDataURLMock).not.toHaveBeenCalled(); // 命中缓存

      // 插入 1 条新数据，触发淘汰：队首此时是 /p/1.png 而非 /p/0.png
      readDataURLMock.mockResolvedValueOnce('newdata');
      await readImageDataUrl('/p/new.png');

      // /p/1.png（被淘汰）应再次调用 IPC
      readDataURLMock.mockResolvedValueOnce('data1-reloaded');
      await readImageDataUrl('/p/1.png');
      expect(readDataURLMock).toHaveBeenCalledWith('/p/1.png');

      // /p/0.png（已 bump）仍命中缓存，不调用 IPC
      readDataURLMock.mockClear();
      await readImageDataUrl('/p/0.png');
      expect(readDataURLMock).not.toHaveBeenCalled();
    });

    it('超过上限 → 淘汰最久未访问（队首）条目', async () => {
      // 填满缓存
      for (let i = 0; i < IMAGE_CACHE_MAX_ENTRIES; i++) {
        readDataURLMock.mockResolvedValueOnce(`data${i}`);
      }
      for (let i = 0; i < IMAGE_CACHE_MAX_ENTRIES; i++) {
        await readImageDataUrl(`/p/${i}.png`);
      }

      // 插入 1 条新数据，触发淘汰 /p/0.png
      readDataURLMock.mockResolvedValueOnce('newdata');
      await readImageDataUrl('/p/new.png');

      // /p/0.png 被淘汰 → 再次读取会触发 IPC
      readDataURLMock.mockResolvedValueOnce('data0-reloaded');
      await readImageDataUrl('/p/0.png');
      expect(readDataURLMock).toHaveBeenCalledWith('/p/0.png');
    });
  });

  describe('错误缓存与 TTL', () => {
    it('读取失败 → reject 并写入错误缓存', async () => {
      readDataURLMock.mockRejectedValueOnce(new Error('file not found'));
      await expect(readImageDataUrl('/err/a.png')).rejects.toThrow('file not found');
    });

    it('TTL 内重读同一文件 → 直接 reject，不调用 IPC', async () => {
      readDataURLMock.mockRejectedValueOnce(new Error('disk error'));
      await expect(readImageDataUrl('/err/ttl.png')).rejects.toThrow('disk error');
      // 第二次：应直接 reject（cached read failure），不调用 IPC
      readDataURLMock.mockClear();
      await expect(readImageDataUrl('/err/ttl.png')).rejects.toThrow('cached read failure');
      expect(readDataURLMock).not.toHaveBeenCalled();
    });

    it('TTL 过期后重读同一文件 → 重新尝试 IPC', async () => {
      readDataURLMock.mockRejectedValueOnce(new Error('first fail'));
      await expect(readImageDataUrl('/err/expired.png')).rejects.toThrow('first fail');

      // 推进时间超过 TTL
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.now() + IMAGE_ERROR_CACHE_TTL_MS + 1000));
      try {
        // 过期后允许重试
        readDataURLMock.mockResolvedValueOnce('recovered-data');
        const result = await readImageDataUrl('/err/expired.png');
        expect(result).toBe('recovered-data');
        expect(readDataURLMock).toHaveBeenCalledWith('/err/expired.png');
      } finally {
        vi.useRealTimers();
      }
    });

    it('clearImageErrorCache(path) → 仅清除指定路径的错误缓存', async () => {
      readDataURLMock.mockRejectedValueOnce(new Error('fail-a'));
      await expect(readImageDataUrl('/err/clear-a.png')).rejects.toThrow('fail-a');
      readDataURLMock.mockRejectedValueOnce(new Error('fail-b'));
      await expect(readImageDataUrl('/err/clear-b.png')).rejects.toThrow('fail-b');

      clearImageErrorCache('/err/clear-a.png');

      // a 已清除 → 重读会调用 IPC
      readDataURLMock.mockResolvedValueOnce('recovered-a');
      const r1 = await readImageDataUrl('/err/clear-a.png');
      expect(r1).toBe('recovered-a');

      // b 未清除 → 仍命中错误缓存
      readDataURLMock.mockClear();
      await expect(readImageDataUrl('/err/clear-b.png')).rejects.toThrow('cached read failure');
      expect(readDataURLMock).not.toHaveBeenCalled();
    });

    it('clearImageErrorCache() 无参 → 清除所有错误缓存', async () => {
      readDataURLMock.mockRejectedValueOnce(new Error('fail-x'));
      await expect(readImageDataUrl('/err/x.png')).rejects.toThrow('fail-x');
      readDataURLMock.mockRejectedValueOnce(new Error('fail-y'));
      await expect(readImageDataUrl('/err/y.png')).rejects.toThrow('fail-y');

      clearImageErrorCache();

      // 两者都应重新调用 IPC
      readDataURLMock.mockResolvedValueOnce('ok-x');
      const r1 = await readImageDataUrl('/err/x.png');
      expect(r1).toBe('ok-x');
      readDataURLMock.mockResolvedValueOnce('ok-y');
      const r2 = await readImageDataUrl('/err/y.png');
      expect(r2).toBe('ok-y');
    });
  });

  describe('clearImageCache', () => {
    it('clearImageCache(path) → 仅清除指定路径的成功缓存', async () => {
      readDataURLMock.mockResolvedValueOnce('data-a');
      await readImageDataUrl('/cache/a.png');
      readDataURLMock.mockResolvedValueOnce('data-b');
      await readImageDataUrl('/cache/b.png');

      clearImageCache('/cache/a.png');

      // a 已清除 → 重新调用 IPC
      readDataURLMock.mockResolvedValueOnce('data-a-2');
      const r1 = await readImageDataUrl('/cache/a.png');
      expect(r1).toBe('data-a-2');

      // b 未清除 → 仍命中缓存
      readDataURLMock.mockClear();
      await readImageDataUrl('/cache/b.png');
      expect(readDataURLMock).not.toHaveBeenCalled();
    });

    it('clearImageCache() 无参 → 清除所有成功缓存', async () => {
      readDataURLMock.mockResolvedValueOnce('data-1');
      await readImageDataUrl('/cache/1.png');
      readDataURLMock.mockResolvedValueOnce('data-2');
      await readImageDataUrl('/cache/2.png');

      clearImageCache();

      // 两者都重新调用 IPC
      readDataURLMock.mockResolvedValueOnce('data-1-2');
      const r1 = await readImageDataUrl('/cache/1.png');
      expect(r1).toBe('data-1-2');
      readDataURLMock.mockResolvedValueOnce('data-2-2');
      const r2 = await readImageDataUrl('/cache/2.png');
      expect(r2).toBe('data-2-2');
    });
  });

  describe('electron bridge 不可用', () => {
    it('window.electronAPI.file.readDataURL 缺失 → reject "electron bridge unavailable"', async () => {
      const original = (window.electronAPI as unknown as { file?: { readDataURL?: unknown } }).file;
      Object.defineProperty(window.electronAPI, 'file', {
        value: {}, // readDataURL 缺失
        writable: true,
        configurable: true,
      });
      try {
        await expect(readImageDataUrl('/no-bridge.png')).rejects.toThrow('electron bridge unavailable');
      } finally {
        Object.defineProperty(window.electronAPI, 'file', {
          value: original,
          writable: true,
          configurable: true,
        });
      }
    });
  });
});
