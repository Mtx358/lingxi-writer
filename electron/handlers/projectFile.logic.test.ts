/**
 * electron/handlers/projectFile.logic.ts 单元测试
 *
 * 测试目标：
 * - parseProjectFileFromBuffer：解压 + JSON 解析 + schema 校验 + zip bomb 检测
 *   - 合法文件解析（全字段填充）
 *   - compressed-too-large（压缩 > 100MB）
 *   - uncompressed-too-large（解压后总条目 > 500MB）
 *   - too-many-versions（版本历史 > 1000 条）
 *   - missing-metadata / incompatible-version / invalid-project / invalid-array-field
 *   - JSON 解析失败 fallback 为 []
 *   - versions/*.json 加载到 versions[chapterId]
 * - generateProjectFileBuffer：生成可被 parse 读回的 zip
 *   - 包含 metadata/project/6 个集合文件
 *   - metadata.checksum = SHA-256(JSON.stringify(project))
 *   - versions 非空 → versions/{chapterId}.json 落盘
 *   - versions 空 → 不生成 versions/ 目录
 *   - round-trip：generate → parse 等价
 * - formatBackupTimestamp / generateBackupFileName：备份文件名格式
 *
 * 本测试无需 mock electron：projectFile.logic.ts 仅依赖 JSZip + node:crypto。
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  parseProjectFileFromBuffer,
  generateProjectFileBuffer,
  formatBackupTimestamp,
  generateBackupFileName,
  ProjectFileValidationError,
  FILE_VERSION,
  MAX_COMPRESSED_SIZE,
  MAX_VERSION_ENTRIES,
  type ProjectFileWriteData,
} from './projectFile.logic';

// 构造一份合法的 ProjectFileWriteData，供 generateProjectFileBuffer / round-trip 测试复用
function makeValidWriteData(): ProjectFileWriteData {
  return {
    project: { id: 'p1', title: '测试小说', author: 'tester' },
    chapters: [{ id: 'c1', title: '第一章', content: '内容...' }],
    characters: [{ id: 'ch1', name: '主角' }],
    settingCategories: [{ id: 'sc1', name: '世界观' }],
    settingItems: [{ id: 'si1', name: '魔法体系' }],
    foreshadows: [{ id: 'f1', name: '伏笔1' }],
    materials: [{ id: 'm1', name: '素材1' }],
    versions: {},
  };
}

// 构造一份合法的 zip Buffer（直接用 JSZip 组装），供 parse 测试复用。
// 可通过 overrides 覆盖特定文件内容或省略文件
async function makeZipBuffer(opts: {
  omitMetadata?: boolean;
  metadataVersion?: string;
  omitProject?: boolean;
  project?: unknown;
  chapters?: unknown;
  characters?: unknown;
  settingCategories?: unknown;
  settingItems?: unknown;
  foreshadows?: unknown;
  materials?: unknown;
  versions?: Record<string, unknown[]>;
  extraFiles?: Record<string, string>;
}): Promise<Buffer> {
  const zip = new JSZip();
  if (!opts.omitMetadata) {
    zip.file('metadata.json', JSON.stringify({
      version: opts.metadataVersion ?? FILE_VERSION,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      checksum: 'fake-checksum',
    }));
  }
  if (!opts.omitProject) {
    // 用 'project' in opts 区分"未提供"（用默认）和"显式传 null"（写入 null）
    const projectContent = 'project' in opts ? opts.project : { id: 'p1', title: 'test' };
    zip.file('project.json', JSON.stringify(projectContent));
  }
  zip.file('chapters.json', JSON.stringify(opts.chapters ?? [{ id: 'c1' }]));
  zip.file('characters.json', JSON.stringify(opts.characters ?? []));
  zip.file('settingCategories.json', JSON.stringify(opts.settingCategories ?? []));
  zip.file('settingItems.json', JSON.stringify(opts.settingItems ?? []));
  zip.file('foreshadows.json', JSON.stringify(opts.foreshadows ?? []));
  zip.file('materials.json', JSON.stringify(opts.materials ?? []));
  if (opts.versions) {
    const dir = zip.folder('versions');
    for (const [chapterId, chapterVersions] of Object.entries(opts.versions)) {
      dir?.file(`${chapterId}.json`, JSON.stringify(chapterVersions));
    }
  }
  if (opts.extraFiles) {
    for (const [name, content] of Object.entries(opts.extraFiles)) {
      zip.file(name, content);
    }
  }
  return await zip.generateAsync({ type: 'nodebuffer' });
}

describe('projectFile.logic / parseProjectFileFromBuffer', () => {
  // -------------------- 合法文件解析 --------------------
  describe('合法文件解析', () => {
    it('全字段填充：metadata/project/6 集合/versions 均正确解析', async () => {
      const buffer = await makeZipBuffer({
        versions: { c1: [{ id: 'v1', content: 'old' }] },
      });
      const data = await parseProjectFileFromBuffer(buffer);
      expect(data.metadata.version).toBe(FILE_VERSION);
      expect(data.project).toEqual({ id: 'p1', title: 'test' });
      expect(data.chapters).toEqual([{ id: 'c1' }]);
      expect(data.characters).toEqual([]);
      expect(data.settingCategories).toEqual([]);
      expect(data.settingItems).toEqual([]);
      expect(data.foreshadows).toEqual([]);
      expect(data.materials).toEqual([]);
      expect(data.versions.c1).toEqual([{ id: 'v1', content: 'old' }]);
    });

    it('versions 多 chapterId 各自加载到 versions[chapterId]', async () => {
      const buffer = await makeZipBuffer({
        versions: {
          c1: [{ id: 'v1' }],
          c2: [{ id: 'v2' }, { id: 'v3' }],
        },
      });
      const data = await parseProjectFileFromBuffer(buffer);
      expect(Object.keys(data.versions).sort()).toEqual(['c1', 'c2']);
      expect(data.versions.c1).toHaveLength(1);
      expect(data.versions.c2).toHaveLength(2);
    });

    it('chapters.json 为非法 JSON 时 fallback 为空数组', async () => {
      const buffer = await makeZipBuffer({
        chapters: undefined,
        extraFiles: { 'chapters.json': '{invalid json' },
      });
      const data = await parseProjectFileFromBuffer(buffer);
      expect(data.chapters).toEqual([]);
    });

    it('集合文件缺失时 fallback 为空数组', async () => {
      // 构造一个缺 characters.json 的 zip
      const zip = new JSZip();
      zip.file('metadata.json', JSON.stringify({ version: FILE_VERSION }));
      zip.file('project.json', JSON.stringify({ id: 'p1' }));
      zip.file('chapters.json', '[]');
      // 故意不添加 characters.json / settingCategories.json 等
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const data = await parseProjectFileFromBuffer(buffer);
      expect(data.characters).toEqual([]);
      expect(data.settingCategories).toEqual([]);
      expect(data.settingItems).toEqual([]);
      expect(data.foreshadows).toEqual([]);
      expect(data.materials).toEqual([]);
    });
  });

  // -------------------- zip bomb 防御 --------------------
  describe('zip bomb 防御', () => {
    it('compressed-too-large：buffer > 100MB 抛错', async () => {
      // 分配 MAX_COMPRESSED_SIZE + 1 字节（~100MB）。
      // 用 allocUnsafe 避免零填充开销；check 在 JSZip.loadAsync 之前发生，内容无关。
      const oversized = Buffer.allocUnsafe(MAX_COMPRESSED_SIZE + 1);
      await expect(parseProjectFileFromBuffer(oversized)).rejects.toMatchObject({
        name: 'ProjectFileValidationError',
        kind: 'compressed-too-large',
        message: expect.stringContaining('100MB'),
      });
    });

    it('uncompressed-too-large：解压后总条目 > 500MB 披错', async () => {
      // 策略：创建小 zip，然后二进制 patch central directory 的 uncompressedSize 字段
      // 为大值（260MB × 2 = 520MB > 500MB），避免实际压缩 500MB 数据导致测试超时。
      //
      // zip central directory file header 格式（每条目）：
      //   偏移 0: 签名 0x02014b50（4 字节 LE）
      //   偏移 24: uncompressedSize（4 字节 LE）← patch 此字段
      // JSZip.loadAsync 从 central directory 读取元数据，不实际解压，
      // 故 patched 的 uncompressedSize 会被 parseProjectFileFromBuffer 的 zip bomb 检测读到
      const small = await makeZipBuffer({});
      const patched = Buffer.from(small);
      const cdSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
      const FAKE_UNCOMPRESSED = 260 * 1024 * 1024; // 260MB per entry
      let patchCount = 0;
      for (let i = 0; i < patched.length - 4; i++) {
        if (patched[i] === cdSignature[0] && patched[i + 1] === cdSignature[1] &&
            patched[i + 2] === cdSignature[2] && patched[i + 3] === cdSignature[3]) {
          // patch uncompressedSize at offset 24（4 字节 LE）
          patched.writeUInt32LE(FAKE_UNCOMPRESSED, i + 24);
          patchCount++;
        }
      }
      // 确保至少 patch 了 2 个条目（520MB > 500MB）
      expect(patchCount).toBeGreaterThanOrEqual(2);
      await expect(parseProjectFileFromBuffer(patched)).rejects.toMatchObject({
        name: 'ProjectFileValidationError',
        kind: 'uncompressed-too-large',
      });
    });

    it('too-many-versions：版本历史 > 1000 条抛错', async () => {
      // 构造 1001 个 versions/*.json 条目（每个内容为 []），超出 MAX_VERSION_ENTRIES
      const zip = new JSZip();
      zip.file('metadata.json', JSON.stringify({ version: FILE_VERSION }));
      zip.file('project.json', JSON.stringify({ id: 'p1' }));
      zip.file('chapters.json', '[]');
      const dir = zip.folder('versions');
      for (let i = 0; i <= MAX_VERSION_ENTRIES; i++) {
        dir?.file(`c${i}.json`, '[]');
      }
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await expect(parseProjectFileFromBuffer(buffer)).rejects.toMatchObject({
        name: 'ProjectFileValidationError',
        kind: 'too-many-versions',
      });
    });
  });

  // -------------------- schema 校验 --------------------
  describe('schema 校验', () => {
    it('missing-metadata：缺 metadata.json 抛错', async () => {
      const buffer = await makeZipBuffer({ omitMetadata: true });
      await expect(parseProjectFileFromBuffer(buffer)).rejects.toMatchObject({
        name: 'ProjectFileValidationError',
        kind: 'missing-metadata',
      });
    });

    it('incompatible-version：metadata.version !== FILE_VERSION 抛错', async () => {
      const buffer = await makeZipBuffer({ metadataVersion: '0.9.0' });
      await expect(parseProjectFileFromBuffer(buffer)).rejects.toMatchObject({
        name: 'ProjectFileValidationError',
        kind: 'incompatible-version',
      });
    });

    it('invalid-project：缺 project.json 抛错', async () => {
      const buffer = await makeZipBuffer({ omitProject: true });
      await expect(parseProjectFileFromBuffer(buffer)).rejects.toMatchObject({
        name: 'ProjectFileValidationError',
        kind: 'invalid-project',
      });
    });

    it('invalid-project：project.json 为非对象（字符串）抛错', async () => {
      const buffer = await makeZipBuffer({ project: 'not-an-object' });
      await expect(parseProjectFileFromBuffer(buffer)).rejects.toMatchObject({
        name: 'ProjectFileValidationError',
        kind: 'invalid-project',
      });
    });

    it('invalid-project：project.json 为 null 抛错', async () => {
      // readJson 返回 null（JSON.parse null），但 null 不通过 !data.project 校验
      const buffer = await makeZipBuffer({ project: null });
      await expect(parseProjectFileFromBuffer(buffer)).rejects.toMatchObject({
        name: 'ProjectFileValidationError',
        kind: 'invalid-project',
      });
    });

    it('invalid-array-field：chapters.json 为字符串抛错', async () => {
      const buffer = await makeZipBuffer({
        chapters: undefined,
        extraFiles: { 'chapters.json': '"not-an-array"' },
      });
      await expect(parseProjectFileFromBuffer(buffer)).rejects.toMatchObject({
        name: 'ProjectFileValidationError',
        kind: 'invalid-array-field',
      });
    });

    it('invalid-array-field：materials.json 为数字抛错', async () => {
      const buffer = await makeZipBuffer({
        materials: undefined,
        extraFiles: { 'materials.json': '42' },
      });
      await expect(parseProjectFileFromBuffer(buffer)).rejects.toMatchObject({
        name: 'ProjectFileValidationError',
        kind: 'invalid-array-field',
        context: { field: 'materials' },
      });
    });
  });

  // -------------------- 非 ProjectFileValidationError 异常 --------------------
  describe('非校验类异常', () => {
    it('非 zip 数据抛错（JSZip.loadAsync 失败，非 ProjectFileValidationError）', async () => {
      const notZip = Buffer.from('this is not a zip file', 'utf-8');
      await expect(parseProjectFileFromBuffer(notZip)).rejects.not.toBeInstanceOf(ProjectFileValidationError);
    });

    it('metadata.json 为非法 JSON 抛错（JSON.parse 失败，非 ProjectFileValidationError）', async () => {
      const buffer = await makeZipBuffer({
        omitMetadata: true,
        extraFiles: { 'metadata.json': '{invalid' },
      });
      await expect(parseProjectFileFromBuffer(buffer)).rejects.not.toBeInstanceOf(ProjectFileValidationError);
    });
  });
});

describe('projectFile.logic / generateProjectFileBuffer', () => {
  it('生成包含全部必需文件的 zip', async () => {
    const buffer = await generateProjectFileBuffer(makeValidWriteData());
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(10);

    // 用 JSZip 验证生成的 zip 结构
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file('metadata.json')).not.toBeNull();
    expect(zip.file('project.json')).not.toBeNull();
    expect(zip.file('chapters.json')).not.toBeNull();
    expect(zip.file('characters.json')).not.toBeNull();
    expect(zip.file('settingCategories.json')).not.toBeNull();
    expect(zip.file('settingItems.json')).not.toBeNull();
    expect(zip.file('foreshadows.json')).not.toBeNull();
    expect(zip.file('materials.json')).not.toBeNull();
  });

  it('metadata 包含 version/createdAt/updatedAt/checksum', async () => {
    const data = makeValidWriteData();
    const buffer = await generateProjectFileBuffer(data);
    const zip = await JSZip.loadAsync(buffer);
    const metadata = JSON.parse(await zip.file('metadata.json')!.async('string'));
    expect(metadata.version).toBe(FILE_VERSION);
    expect(typeof metadata.createdAt).toBe('string');
    expect(typeof metadata.updatedAt).toBe('string');
    expect(typeof metadata.checksum).toBe('string');
  });

  it('checksum = SHA-256(JSON.stringify(project))', async () => {
    const data = makeValidWriteData();
    const buffer = await generateProjectFileBuffer(data);
    const zip = await JSZip.loadAsync(buffer);
    const metadata = JSON.parse(await zip.file('metadata.json')!.async('string'));
    const expectedChecksum = createHash('sha256')
      .update(JSON.stringify(data.project), 'utf-8')
      .digest('hex');
    expect(metadata.checksum).toBe(expectedChecksum);
  });

  it('versions 非空对象时生成 versions/{chapterId}.json', async () => {
    const data = makeValidWriteData();
    data.versions = {
      c1: [{ id: 'v1', content: 'old' }],
      c2: [{ id: 'v2' }],
    };
    const buffer = await generateProjectFileBuffer(data);
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file('versions/c1.json')).not.toBeNull();
    expect(zip.file('versions/c2.json')).not.toBeNull();
    const v1 = JSON.parse(await zip.file('versions/c1.json')!.async('string'));
    expect(v1).toEqual([{ id: 'v1', content: 'old' }]);
  });

  it('versions 为空对象时不生成 versions/ 目录', async () => {
    const data = makeValidWriteData();
    data.versions = {};
    const buffer = await generateProjectFileBuffer(data);
    const zip = await JSZip.loadAsync(buffer);
    const versionFiles = Object.keys(zip.files).filter(n => n.startsWith('versions/'));
    expect(versionFiles).toHaveLength(0);
  });

  it('round-trip：generate → parse 返回等价数据', async () => {
    const original = makeValidWriteData();
    original.versions = { c1: [{ id: 'v1', content: 'old version' }] };
    const buffer = await generateProjectFileBuffer(original);
    const parsed = await parseProjectFileFromBuffer(buffer);

    expect(parsed.project).toEqual(original.project);
    expect(parsed.chapters).toEqual(original.chapters);
    expect(parsed.characters).toEqual(original.characters);
    expect(parsed.settingCategories).toEqual(original.settingCategories);
    expect(parsed.settingItems).toEqual(original.settingItems);
    expect(parsed.foreshadows).toEqual(original.foreshadows);
    expect(parsed.materials).toEqual(original.materials);
    expect(parsed.versions.c1).toEqual([{ id: 'v1', content: 'old version' }]);
    expect(parsed.metadata.version).toBe(FILE_VERSION);
  });
});

describe('projectFile.logic / formatBackupTimestamp', () => {
  it('ISO 时间中 : 和 . 替换为 -', () => {
    // 固定时间避免 flaky：2024-06-15T12:30:45.123Z
    const date = new Date('2024-06-15T12:30:45.123Z');
    const ts = formatBackupTimestamp(date);
    // 原 ISO: 2024-06-15T12:30:45.123Z → 替换 : 和 . → 2024-06-15T12-30-45-123Z
    expect(ts).toBe('2024-06-15T12-30-45-123Z');
    expect(ts).not.toContain(':');
    expect(ts).not.toContain('.');
  });

  it('默认参数使用当前时间（不抛错）', () => {
    const ts = formatBackupTimestamp();
    expect(typeof ts).toBe('string');
    expect(ts).not.toContain(':');
    expect(ts).not.toContain('.');
  });
});

describe('projectFile.logic / generateBackupFileName', () => {
  it('返回 <timestamp>.cwp 格式', () => {
    const date = new Date('2024-06-15T12:30:45.123Z');
    const name = generateBackupFileName(date);
    expect(name).toBe('2024-06-15T12-30-45-123Z.cwp');
    expect(name.endsWith('.cwp')).toBe(true);
  });

  it('与 formatBackupTimestamp 一致（仅追加 .cwp 后缀）', () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    const ts = formatBackupTimestamp(date);
    const name = generateBackupFileName(date);
    expect(name).toBe(`${ts}.cwp`);
  });
});
