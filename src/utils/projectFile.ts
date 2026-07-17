import JSZip from 'jszip';
import type { Project, Chapter, Character, SettingCategory, SettingItem, Foreshadow, Material, ChapterVersion } from '@/types';
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
  if (!metadata || metadata.version !== FILE_VERSION) {
    throw new Error('不兼容的工程文件版本');
  }
  
  const projectData = await readJsonFile<Project>(zip, 'project.json');
  if (!projectData) {
    throw new Error('缺少项目信息');
  }
  
  const chapters = await readJsonFile<Chapter[]>(zip, 'chapters.json') || [];
  const characters = await readJsonFile<Character[]>(zip, 'characters.json') || [];
  const settingCategories = await readJsonFile<SettingCategory[]>(zip, 'settingCategories.json') || [];
  const settingItems = await readJsonFile<SettingItem[]>(zip, 'settingItems.json') || [];
  const foreshadows = await readJsonFile<Foreshadow[]>(zip, 'foreshadows.json') || [];
  const materials = await readJsonFile<Material[]>(zip, 'materials.json') || [];
  
  const versions: Record<string, ChapterVersion[]> = {};
  const versionsFolder = zip.folder('versions');
  if (versionsFolder) {
    const files = Object.keys(versionsFolder.files);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const chapterId = file.slice(0, -5);
        // 读取增量 Diff 存储的版本，链式重建出完整内容
        const stored = await readJsonFile<ReturnType<typeof encodeVersionsToDeltas>>(versionsFolder!, file) || [];
        versions[chapterId] = decodeDeltasToVersions(stored);
      }
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