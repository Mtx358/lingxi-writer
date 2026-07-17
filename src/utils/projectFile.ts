import JSZip from 'jszip';
import type { Project, Chapter, Character, SettingCategory, SettingItem, Foreshadow, Material, ChapterVersion } from '@/types';
import { levelToLevelType, DEFAULT_CHAPTER_STATUS } from '@/types';
import { encodeVersionsToDeltas, decodeDeltasToVersions } from '@/utils/versionDelta';

export interface ProjectFileContent {
  project: Project;
  chapters: Chapter[];
  characters: Character[];
  settingCategories: SettingCategory[];
  settingItems: SettingItem[];
  foreshadows: Foreshadow[];
  materials: Material[];
  versions: Record<string, ChapterVersion[]>;
}

export interface ProjectFileMetadata {
  version: string;
  createdAt: string;
  updatedAt: string;
  checksum: string;
}

const FILE_VERSION = '1.0.0';

// 解析 semver 字符串为 [major, minor, patch]，无法解析时返回 null
const parseSemver = (v: string | undefined | null): [number, number, number] | null => {
  if (!v) return null;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
};

// 主版本相同即视为兼容（兼容旧 1.x 文件，避免硬编码版本号导致无法读取）
const isCompatibleVersion = (fileVersion: string | undefined): boolean => {
  const fileSem = parseSemver(fileVersion);
  const appSem = parseSemver(FILE_VERSION);
  if (!fileSem || !appSem) return false;
  return fileSem[0] === appSem[0];
};

// 对老版本文件中缺失的字段补默认值，避免下游代码因 undefined 崩溃
const normalizeChapter = (c: Partial<Chapter>): Chapter => ({
  ...c,
  title: c.title ?? '',
  parentId: c.parentId ?? null,
  summary: c.summary ?? '',
  order: c.order ?? 0,
  level: c.level ?? 1,
  levelType: c.levelType ?? levelToLevelType(c.level ?? 1),
  status: c.status ?? DEFAULT_CHAPTER_STATUS,
  wordCount: c.wordCount ?? 0,
  content: c.content ?? '',
  createdAt: c.createdAt ?? new Date(0).toISOString(),
  updatedAt: c.updatedAt ?? new Date(0).toISOString(),
}) as Chapter;

export async function createProjectFile(project: Project, chapters: Chapter[], characters: Character[], settingCategories: SettingCategory[], settingItems: SettingItem[], foreshadows: Foreshadow[], materials: Material[], versions: Record<string, ChapterVersion[]>): Promise<Buffer> {
  const zip = new JSZip();
  
  const metadata: ProjectFileMetadata = {
    version: FILE_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    checksum: generateChecksum(project, chapters),
  };
  
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));
  zip.file('project.json', JSON.stringify(project, null, 2));
  zip.file('chapters.json', JSON.stringify(chapters, null, 2));
  zip.file('characters.json', JSON.stringify(characters, null, 2));
  zip.file('settingCategories.json', JSON.stringify(settingCategories, null, 2));
  zip.file('settingItems.json', JSON.stringify(settingItems, null, 2));
  zip.file('foreshadows.json', JSON.stringify(foreshadows, null, 2));
  zip.file('materials.json', JSON.stringify(materials, null, 2));
  
  if (Object.keys(versions).length > 0) {
    const versionsDir = zip.folder('versions');
    Object.entries(versions).forEach(([chapterId, chapterVersions]) => {
      // 增量 Diff 编码后再写入，降低文件体积
      const stored = encodeVersionsToDeltas(chapterVersions);
      versionsDir?.file(`${chapterId}.json`, JSON.stringify(stored, null, 2));
    });
  }
  
  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function readProjectFile(buffer: Buffer): Promise<ProjectFileContent> {
  const zip = await JSZip.loadAsync(buffer);

  const metadata = await readJsonFile<ProjectFileMetadata>(zip, 'metadata.json');
  if (!metadata || !isCompatibleVersion(metadata.version)) {
    throw new Error('不兼容的工程文件版本');
  }

  const projectData = await readJsonFile<Project>(zip, 'project.json');
  if (!projectData) {
    throw new Error('缺少项目信息');
  }

  const rawChapters = await readJsonFile<Partial<Chapter>[]>(zip, 'chapters.json') || [];
  // 对老版本文件缺失的字段补默认值（levelType/status/content 等）
  const chapters = rawChapters.map(normalizeChapter);
  const characters = await readJsonFile<Character[]>(zip, 'characters.json') || [];
  const settingCategories = await readJsonFile<SettingCategory[]>(zip, 'settingCategories.json') || [];
  const settingItems = await readJsonFile<SettingItem[]>(zip, 'settingItems.json') || [];
  const foreshadows = await readJsonFile<Foreshadow[]>(zip, 'foreshadows.json') || [];
  const materials = await readJsonFile<Material[]>(zip, 'materials.json') || [];

  // 校验和仅做弱校验：不一致时 warning 提示，不阻塞读取（避免弱哈希误报误导用户）
  if (metadata.checksum) {
    const currentChecksum = generateChecksum(projectData, chapters);
    if (currentChecksum !== metadata.checksum) {
      console.warn('项目文件校验和不一致，可能已损坏或被外部修改：存储值', metadata.checksum, '实际值', currentChecksum);
    }
  }

  const versions: Record<string, ChapterVersion[]> = {};
  // 直接从根 zip 按完整路径读取，过滤 versions/*.json。
  // 原实现用 zip.folder('versions').files 会返回整个 zip 的所有文件，
  // 且 versionsFolder.file(file) 会拼成 versions/versions/chapterId.json 导致找不到。
  const allFiles = Object.keys(zip.files);
  for (const f of allFiles) {
    if (f.startsWith('versions/') && f.endsWith('.json')) {
      const chapterId = f.slice('versions/'.length, -5);
      const stored = await readJsonFile<ReturnType<typeof encodeVersionsToDeltas>>(zip, f) || [];
      versions[chapterId] = decodeDeltasToVersions(stored);
    }
  }

  return {
    project: projectData,
    chapters,
    characters,
    settingCategories,
    settingItems,
    foreshadows,
    materials,
    versions,
  };
}

export async function validateProjectFile(buffer: Buffer): Promise<{ valid: boolean; error?: string }> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    
    const requiredFiles = ['metadata.json', 'project.json', 'chapters.json'];
    for (const file of requiredFiles) {
      if (!zip.file(file)) {
        return { valid: false, error: `缺少必要文件: ${file}` };
      }
    }
    
    const metadata = await readJsonFile<ProjectFileMetadata>(zip, 'metadata.json');
    if (!metadata) {
      return { valid: false, error: '无效的元数据' };
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}

async function readJsonFile<T>(zip: JSZip, path: string): Promise<T | null> {
  const file = zip.file(path);
  if (!file) return null;
  
  const content = await file.async('string');
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function generateChecksum(project: Project, chapters: Chapter[]): string {
  const data = JSON.stringify({ projectId: project.id, chapterCount: chapters.length });
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function getProjectFileExtension(): string {
  return '.cwp';
}

export function generateProjectFileName(project: Project): string {
  const safeTitle = project.title.replace(/[\\/:*?"<>|]/g, '_');
  return `${safeTitle}${getProjectFileExtension()}`;
}