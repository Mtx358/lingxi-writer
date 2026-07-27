/**
 * 图片 dataURL 缓存（模块级单例）
 *
 * 抽离到 utils 层的原因：原实现位于 MaterialsPanel.tsx，而项目切换/关闭时
 * 需要由 store 层（projectSlice.closeProject）主动清理缓存以释放内存。
 * 若 store 反向 import 组件层会形成循环依赖（MaterialsPanel → useAppStore → projectSlice），
 * 因此将缓存 Map 与读/清逻辑迁移到独立的 utils 模块，组件层与 store 层都从此处导入。
 *
 * - LRU 策略：命中时 bump 到队尾，超过上限淘汰队首
 * - 错误缓存带 TTL，避免对损坏文件反复触发 IO；过期后允许重试（用户可能已修复）
 */
import { IMAGE_CACHE_MAX_ENTRIES, IMAGE_ERROR_CACHE_TTL_MS } from '@/constants/config';
import { registerProjectCleanup } from '@/store/projectCleanup';

const imageDataUrlCache = new Map<string, Promise<string>>();
const imageDataUrlErrors = new Map<string, number>();

/**
 * 读取 file:// 路径对应的 dataURL，命中缓存时直接返回 Promise。
 * 失败时写入错误缓存并在 TTL 内直接 reject，避免重复 IO。
 */
export function readImageDataUrl(filePath: string): Promise<string> {
  // 命中：删除后重新插入，将其挪到 LRU 队尾
  if (imageDataUrlCache.has(filePath)) {
    const promise = imageDataUrlCache.get(filePath)!;
    imageDataUrlCache.delete(filePath);
    imageDataUrlCache.set(filePath, promise);
    return promise;
  }
  // 已知失败：避免对同一损坏文件反复触发读取；但带 TTL，过期后允许重试
  const failedAt = imageDataUrlErrors.get(filePath);
  if (failedAt !== undefined) {
    if (Date.now() - failedAt < IMAGE_ERROR_CACHE_TTL_MS) {
      return Promise.reject(new Error('cached read failure'));
    }
    // 过期：清除错误缓存，重新尝试读取（用户可能已修复文件）
    imageDataUrlErrors.delete(filePath);
  }

  const electronAPI = window.electronAPI?.file?.readDataURL;
  const reader = electronAPI ?? (() => Promise.reject(new Error('electron bridge unavailable')));
  const promise = (reader as (p: string) => Promise<string>)(filePath).catch(err => {
    imageDataUrlCache.delete(filePath);
    imageDataUrlErrors.set(filePath, Date.now());
    throw err;
  });
  imageDataUrlCache.set(filePath, promise);

  // LRU 淘汰：超过上限时丢弃最久未访问（队首）的条目
  while (imageDataUrlCache.size > IMAGE_CACHE_MAX_ENTRIES) {
    const oldest = imageDataUrlCache.keys().next().value;
    if (oldest === undefined) break;
    imageDataUrlCache.delete(oldest);
  }
  return promise;
}

/**
 * 清空图片错误缓存（可选传入 path 仅清单个）。
 * 用于附件列表刷新、用户手动"重新加载"等场景，确保已修复的图片能立即重试读取。
 */
export function clearImageErrorCache(path?: string): void {
  if (path) {
    imageDataUrlErrors.delete(path);
  } else {
    imageDataUrlErrors.clear();
  }
}

/**
 * 清空图片 dataURL 成功缓存（可选传入 path 仅清单个）。
 * 项目切换或主动释放内存时调用：模块级缓存跨项目共享，长期使用会导致内存上涨。
 */
export function clearImageCache(path?: string): void {
  if (path) {
    imageDataUrlCache.delete(path);
  } else {
    imageDataUrlCache.clear();
  }
}

// 项目切换时自动清理图片缓存（成功 + 错误），避免上一项目 dataURL 残留
registerProjectCleanup(() => clearImageCache());
registerProjectCleanup(() => clearImageErrorCache());
