// projectFile handler 的纯函数实现：解压 / 校验 / 生成 zip / 备份文件名生成。
// 本模块不依赖 electron（dialog/fs/ipcMain），仅依赖 JSZip 与 node 内置 crypto，
// 可被单元测试直接 import 而无需 vi.mock('electron')。
//
// 抽离目的：projectFile.ts 的 IPC handler 主体逻辑（parseProjectFileFromBuffer /
// generateProjectFileBuffer / 备份文件名）此前因 app.whenReady 永不 resolve 而
// 无法被测试覆盖，此处抽离为纯函数供 handler 调用并由 *.logic.test.ts 直接测试。
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

// 与 ./shared 的 FILE_VERSION 同步：抽离到本模块避免引入 electron 依赖。
// 修改时需同步修改 ./shared.ts 的 FILE_VERSION。
export const FILE_VERSION = '1.0.0';

// 体积上限常量：与 projectFile.ts 的 IPC handler 保持一致。
// - 100MB：压缩文件本体上限（防 zip bomb 触发 OOM）
// - 500MB：解压后总条目体积上限
// - 1000：versions/*.json 条目数上限
export const MAX_COMPRESSED_SIZE = 100 * 1024 * 1024;
export const MAX_UNCOMPRESSED_SIZE = 500 * 1024 * 1024;
export const MAX_VERSION_ENTRIES = 1000;

// ProjectFileData 形状：与 projectFile:read 返回值结构一致。
// metadata 留 unknown：实际只校验 version 字段，不约束 metadata 其他字段形状。
export interface ProjectFileData {
  metadata: { version: string; [key: string]: unknown };
  project: unknown;
  chapters: unknown[];
  characters: unknown[];
  settingCategories: unknown[];
  settingItems: unknown[];
  foreshadows: unknown[];
  materials: unknown[];
  versions: Record<string, unknown[]>;
}

// projectFile:write 入参形状（与 IPC handler 签名一致）
export interface ProjectFileWriteData {
  project: unknown;
  chapters: unknown;
  characters: unknown;
  settingCategories: unknown;
  settingItems: unknown;
  foreshadows: unknown;
  materials: unknown;
  versions: unknown;
}

// ProjectFileValidationError 类型：纯函数解析失败时抛出，handler 据此返回具体错误消息
// 并按 kind 写入对应的 audit 日志（与原 handler 内联校验时的 audit 行为一致）。
export type ProjectFileValidationErrorKind =
  | 'compressed-too-large'
  | 'uncompressed-too-large'
  | 'too-many-versions'
  | 'missing-metadata'
  | 'incompatible-version'
  | 'invalid-project'
  | 'invalid-array-field';

export class ProjectFileValidationError extends Error {
  readonly kind: ProjectFileValidationErrorKind;
  readonly context: { size?: number; total?: number; count?: number; field?: string };
  constructor(
    kind: ProjectFileValidationErrorKind,
    message: string,
    context: { size?: number; total?: number; count?: number; field?: string } = {},
  ) {
    super(message);
    this.name = 'ProjectFileValidationError';
    this.kind = kind;
    this.context = context;
  }
}

// 生成 project.json 内容的 SHA-256 checksum，与 projectFile.ts 内一致。
// 抽离此函数避免依赖 ./shared.generateChecksum（shared 顶层 import electron）。
function generateChecksum(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

// 解析 .cwp 工程文件 Buffer：解压 + JSON 解析 + schema 校验 + zip bomb 检测。
// 抽离自 projectFile.ts 的 projectFile:read handler 主体逻辑（输入校验之后的部分）。
//
// 输入：完整的 .cwp 文件字节（handler 已通过 isSafeProjectFilePath + realpath 校验）
// 输出：ProjectFileData（与 handler 返回值中 data 字段结构一致）
// 异常：抛 ProjectFileValidationError 时 handler 应捕获并返回 { success: false, error: e.message }，
//   并按 kind 写 audit 日志（与原 handler 内联校验时一致）；
//   抛其他 Error 时（JSZip / JSON.parse 失败）handler 应返回通用错误消息。
//
// 与原 handler 行为对齐：
// - 压缩文件 > 100MB → 抛 compressed-too-large，消息 '工程文件过大（超过 100MB），可能损坏或为压缩炸弹'
// - 解压后总条目体积 > 500MB → 抛 uncompressed-too-large，消息 '工程文件解压后体积过大（超过 500MB），可能为压缩炸弹'
// - metadata.json 缺失 → 抛 missing-metadata，消息 '缺少元数据文件'
// - metadata.version !== FILE_VERSION → 抛 incompatible-version，消息 `不兼容的文件版本: ${version}`
// - versions 条目数 > 1000 → 抛 too-many-versions，消息 '工程文件包含过多版本历史条目（超过 1000），可能损坏'
// - project.json 缺失或非对象 → 抛 invalid-project，消息 '工程文件缺少有效的 project.json'
// - 6 个集合字段非数组 → 抛 invalid-array-field，消息 `工程文件的 ${field} 数据不是有效数组`
export async function parseProjectFileFromBuffer(buffer: Buffer): Promise<ProjectFileData> {
  // 体积校验：防 zip bomb。读取后先校验压缩文件本身不超过 100MB，
  // 超出拒绝并审计日志，避免恶意 .cwp 触发主进程 OOM
  if (buffer.length > MAX_COMPRESSED_SIZE) {
    throw new ProjectFileValidationError(
      'compressed-too-large',
      '工程文件过大（超过 100MB），可能损坏或为压缩炸弹',
      { size: buffer.length },
    );
  }

  const zip = await JSZip.loadAsync(buffer);

  // 解压炸弹防御：累计所有条目的 uncompressedSize，总和超过 500MB 拒绝。
  // 必须在任何 async('string') 实际解压前完成，否则仍可能 OOM
  let totalUncompressed = 0;
  for (const entry of Object.values(zip.files)) {
    const uncompressed = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof uncompressed === 'number') {
      totalUncompressed += uncompressed;
      if (totalUncompressed > MAX_UNCOMPRESSED_SIZE) {
        throw new ProjectFileValidationError(
          'uncompressed-too-large',
          '工程文件解压后体积过大（超过 500MB），可能为压缩炸弹',
          { total: totalUncompressed },
        );
      }
    }
  }

  const metadataStr = await zip.file('metadata.json')?.async('string');
  if (!metadataStr) {
    throw new ProjectFileValidationError('missing-metadata', '缺少元数据文件');
  }
  // cast 为 { version: string; [key: string]: unknown }：运行时通过下方 version !== FILE_VERSION
  // 校验拦截非字符串/不兼容版本。若 version 为 undefined/number，!== 比较为 true → 抛 incompatible-version
  const metadata = JSON.parse(metadataStr) as { version: string; [key: string]: unknown };
  if (metadata.version !== FILE_VERSION) {
    throw new ProjectFileValidationError(
      'incompatible-version',
      `不兼容的文件版本: ${metadata.version}`,
    );
  }

  const readJson = async <T>(filename: string): Promise<T | null> => {
    const file = zip.file(filename);
    if (!file) return null;
    const content = await file.async('string');
    try {
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  };

  const data: ProjectFileData = {
    metadata,
    project: await readJson('project.json'),
    chapters: (await readJson<unknown[]>('chapters.json')) || [],
    characters: (await readJson<unknown[]>('characters.json')) || [],
    settingCategories: (await readJson<unknown[]>('settingCategories.json')) || [],
    settingItems: (await readJson<unknown[]>('settingItems.json')) || [],
    foreshadows: (await readJson<unknown[]>('foreshadows.json')) || [],
    materials: (await readJson<unknown[]>('materials.json')) || [],
    versions: {},
  };

  // 版本历史加载：
  // 之前用 zip.folder('versions').files 遍历会返回整个 zip 的全部条目路径，
  // 修复：用根 zip 按完整路径过滤，chapterId 截取 'versions/' 前缀长度。
  const versionFiles = Object.keys(zip.files).filter(name =>
    name.startsWith('versions/') && name.endsWith('.json')
  );
  // 版本历史条目数量上限：防恶意 .cwp 塞入海量 versions/*.json 拖慢读取
  if (versionFiles.length > MAX_VERSION_ENTRIES) {
    throw new ProjectFileValidationError(
      'too-many-versions',
      '工程文件包含过多版本历史条目（超过 1000），可能损坏',
      { count: versionFiles.length },
    );
  }
  for (const f of versionFiles) {
    const chapterId = f.slice('versions/'.length, -5);
    data.versions[chapterId] = (await readJson<unknown[]>(f)) || [];
  }

  // 形状校验：被篡改/损坏的 .cwp 文件中 chapters.json 可能是字符串/null 等非数组，
  // 或 project.json 缺失。6 个集合字段在 readJson 失败时已 fallback 为 []，
  // 但若 zip 中存储的是非数组的合法 JSON（如 "string" 或 42），fallback 不生效，需在此拦截。
  if (!data.project || typeof data.project !== 'object') {
    throw new ProjectFileValidationError('invalid-project', '工程文件缺少有效的 project.json');
  }
  const arrayFieldNames = ['chapters', 'characters', 'settingCategories', 'settingItems', 'foreshadows', 'materials'] as const;
  for (const f of arrayFieldNames) {
    if (!Array.isArray(data[f])) {
      throw new ProjectFileValidationError(
        'invalid-array-field',
        `工程文件的 ${f} 数据不是有效数组`,
        { field: f },
      );
    }
  }

  return data;
}

// 生成 .cwp 工程文件 Buffer（zip 格式）。
// 抽离自 projectFile.ts 的 projectFile:write handler 主体逻辑（zip 生成部分）。
//
// 输入：ProjectFileWriteData（handler 已通过 isValidProjectFileData 校验形状）
// 输出：完整的 .cwp 字节，可被 parseProjectFileFromBuffer 读回
//
// 与原 handler 一致：
// - metadata 包含 version/createdAt/updatedAt/checksum（SHA-256 of JSON.stringify(project)）
// - 各集合字段以 JSON.stringify(value, null, 2) 落盘
// - versions 非空对象时按 chapterId 落盘到 versions/<chapterId>.json
// - zip.generateAsync({ type: 'nodebuffer' })
export async function generateProjectFileBuffer(data: ProjectFileWriteData): Promise<Buffer> {
  const zip = new JSZip();

  const metadata = {
    version: FILE_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    checksum: generateChecksum(JSON.stringify(data.project)),
  };

  zip.file('metadata.json', JSON.stringify(metadata, null, 2));
  zip.file('project.json', JSON.stringify(data.project, null, 2));
  zip.file('chapters.json', JSON.stringify(data.chapters, null, 2));
  zip.file('characters.json', JSON.stringify(data.characters, null, 2));
  zip.file('settingCategories.json', JSON.stringify(data.settingCategories, null, 2));
  zip.file('settingItems.json', JSON.stringify(data.settingItems, null, 2));
  zip.file('foreshadows.json', JSON.stringify(data.foreshadows, null, 2));
  zip.file('materials.json', JSON.stringify(data.materials, null, 2));

  if (data.versions && typeof data.versions === 'object' && Object.keys(data.versions).length > 0) {
    const versionsDir = zip.folder('versions');
    Object.entries(data.versions as Record<string, unknown>).forEach(([chapterId, chapterVersions]) => {
      versionsDir?.file(`${chapterId}.json`, JSON.stringify(chapterVersions, null, 2));
    });
  }

  return await zip.generateAsync({ type: 'nodebuffer' });
}

// 生成备份文件名的时间戳部分：ISO 时间去掉 ':' 和 '.'，与 projectFile:backup handler 一致。
// 抽离自 projectFile:backup handler 的 `new Date().toISOString().replace(/[:.]/g, '-')`
//
// 接受可选 date 参数便于测试（默认 now）：测试可固定时间戳避免断言 flaky
export function formatBackupTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

// 组装备份文件名：<timestamp>.cwp，与 projectFile:backup handler 一致。
// 抽离此函数便于测试备份文件名格式正确（timestamp 含 '-' 不含 ':'，后缀 .cwp）
export function generateBackupFileName(date: Date = new Date()): string {
  return `${formatBackupTimestamp(date)}.cwp`;
}
