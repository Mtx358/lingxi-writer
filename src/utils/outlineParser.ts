/**
 * 结构化大纲智能解析器
 *
 * 识别小说大纲中的结构化元素，映射到软件数据模型：
 * - 项目标题（# 《xxx》）
 * - 卷（## 卷X：xxx）→ volume 级章节
 * - 部（### 上部·xxx / 中部 / 下部）→ part 级章节
 * - 卷元数据（**卷字数** / **时间跨度** / **史诗定位** / **核心命题**）
 * - 设定（## 全书总纲 → ### 核心立意 / ### 核心设定）
 * - 伏笔（**混沌双生·本卷反噬**）
 * - 人物（从元数据行与全文频率提取）
 *
 * 解析器设计为通用：只要符合「# / ## / ### 标题层级 + **字段**：值」
 * 的 markdown 大纲格式均可识别，不绑定特定作品。
 */
import DOMPurify from 'dompurify';
import { escapeHtml } from '@/lib/htmlUtils';
import { escapeRegExp } from '@/lib/regexUtils';

// ==================== 解析结果类型 ====================

export interface ParsedPart {
  title: string;
  order: number;
  content: string;
  wordCount: number;
}

export interface ParsedForeshadow {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ParsedVolume {
  title: string;
  order: number;
  wordTarget?: number;
  timeSpan?: string;
  epicPositioning?: string;
  coreProposition?: string;
  notes?: string;
  parts: ParsedPart[];
  foreshadows: ParsedForeshadow[];
}

export interface ParsedCharacter {
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting' | 'minor';
  profile: {
    background?: string;
    motivation?: string;
    arc?: string;
  };
  mentionCount: number;
}

export interface ParsedSettingItem {
  name: string;
  content: string;
}

export interface ParsedSetting {
  categoryName: string;
  items: ParsedSettingItem[];
}

export interface ParsedOutline {
  title: string;
  description: string;
  volumes: ParsedVolume[];
  characters: ParsedCharacter[];
  settings: ParsedSetting[];
  foreshadows: ParsedForeshadow[];
  totalWords: number;
}

// ==================== 工具函数 ====================

function countWords(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + englishWords;
}

function textToHtml(text: string): string {
  return text
    .split('\n')
    .filter(l => l.trim())
    .map(l => `<p>${escapeHtml(l.trim())}</p>`)
    .join('\n');
}

/** 解析"80万字" / "80万" / "800000" 为数字 */
function parseWordCount(s: string): number | undefined {
  const m = s.match(/([\d]+)\s*万/);
  if (m) return parseInt(m[1], 10) * 10000;
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return isNaN(n) ? undefined : n;
}

/** 提取 **字段**：值 或 **字段**:值 中的值 */
function extractField(line: string, fieldName: string): string | null {
  const re = new RegExp(`\\*\\*${escapeRegExp(fieldName)}\\*\\*[：:]\\s*(.+)`);
  const m = line.match(re);
  return m ? m[1].trim() : null;
}

// ==================== 人物识别 ====================

// 常见中文姓氏（用于辅助人名识别）
const COMMON_SURNAMES = Array.from(new Set([
  '刘', '关', '张', '赵', '马', '黄', '诸葛', '庞', '徐', '司', '曹', '孙',
  '周', '吕', '陆', '鲁', '魏', '姜', '霍', '王', '李', '陈', '杨',
  '吴', '郑', '冯', '褚', '卫', '蒋', '沈', '韩', '朱', '秦',
  '何', '施', '孔', '严', '华', '金', '陶', '戚', '谢',
]));

// 已知三国人物（提高识别准确率，非硬性依赖）
const KNOWN_FIGURES = new Set([
  '刘封', '刘备', '关羽', '张飞', '赵云', '马超', '黄忠', '诸葛亮', '庞统',
  '徐晃', '司马懿', '曹操', '曹丕', '曹芳', '孙权', '孙皓', '周瑜', '吕蒙',
  '陆逊', '鲁肃', '魏延', '霍峻', '霍弋', '法正', '刘禅', '刘表', '刘璋',
  '刘琦', '于禁', '庞德', '夏侯渊', '张郃', '张松', '张肃', '王平', '吴懿',
  '李严', '马忠', '孟获', '雍闿', '朱褒', '高定元', '申耽', '蒯祺', '糜芳',
  '傅士仁', '济火',
]);

/**
 * 从元数据行中提取人名
 * 例如："庞统226年病逝、刘备227年驾崩、关羽228年辞世" → [庞统, 刘备, 关羽]
 */
function extractNamesFromMetadata(text: string): Set<string> {
  const names = new Set<string>();
  // 匹配 "XX数字年" 模式（寿数礼制行）
  const lifespanMatches = text.matchAll(/([\u4e00-\u9fa5]{2,4})\d{3}年[病战善辞驾薨]/g);
  for (const m of lifespanMatches) {
    names.add(m[1]);
  }
  // 匹配 "XX为「xxx」" / "XX唯一核心主角" 模式（人物定位行）
  const roleMatches = text.matchAll(/([\u4e00-\u9fa5]{2,4})(?:唯一|为|是|率|遣|令|封|拜|升|镇守|都督|主攻|侧应|出兵|归降|病逝|战死|辞世|善终|驾崩|薨逝|终老)/g);
  for (const m of roleMatches) {
    const name = m[1];
    if (KNOWN_FIGURES.has(name) || COMMON_SURNAMES.some(s => name.startsWith(s))) {
      names.add(name);
    }
  }
  return names;
}

/**
 * 统计全文中各人名出现频率，结合元数据提取结果
 */
function extractCharacters(fullText: string, metadataText: string): ParsedCharacter[] {
  const knownNames = new Set<string>(KNOWN_FIGURES);
  // 从元数据中提取的人名
  const metadataNames = extractNamesFromMetadata(metadataText);
  metadataNames.forEach(n => knownNames.add(n));

  // 统计频率
  const counts = new Map<string, number>();
  for (const name of knownNames) {
    // 用正则全局匹配计数（转义人名中可能的正则元字符，如笔名"小.明"）
    const re = new RegExp(escapeRegExp(name), 'g');
    const matches = fullText.match(re);
    if (matches && matches.length >= 2) {
      counts.set(name, matches.length);
    }
  }

  // 按频率排序
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return [];

  // 最高频的作为主角
  const maxCount = sorted[0][1];
  const characters: ParsedCharacter[] = sorted.map(([name, count], idx) => {
    let role: ParsedCharacter['role'] = 'supporting';
    if (idx === 0) role = 'protagonist';
    else if (count < maxCount * 0.15) role = 'minor';

    // 从元数据提取角色背景
    const profile: ParsedCharacter['profile'] = {};
    // 寿数信息
    const lifespanMatch = metadataText.match(new RegExp(`${name}(\\d{3}年[^、。，；]+)`));
    if (lifespanMatch) {
      profile.background = lifespanMatch[1];
    }

    return { name, role, profile, mentionCount: count };
  });

  return characters;
}

// ==================== 主解析函数 ====================

export function parseOutline(text: string): ParsedOutline {
  // 体积校验：超长大纲阻塞主线程，1MB 上限足以容纳任何正常小说大纲。
  // 优先截断而非拒绝——用户可能确实有大型大纲，截断后仍可解析前半部分
  let outlineText = text;
  if (text.length > 1024 * 1024) {
    console.warn(`[outlineParser] 输入过大（${text.length} 字符），截断到 1MB 后解析`);
    outlineText = text.slice(0, 1024 * 1024);
  }
  const lines = outlineText.split('\n');

  let title = '导入大纲作品';
  let description = '';
  // 只有遇到 # 一级标题（作品名）后，才开始收集项目描述。
  // 否则文档开头的"1. **八卷结构**：..."等修改说明会被误判为描述。
  let titleFound = false;
  const volumes: ParsedVolume[] = [];
  const settings: ParsedSetting[] = [];
  const allForeshadows: ParsedForeshadow[] = [];

  // 收集元数据文本（用于人物识别）
  let metadataText = '';

  // 解析状态
  let currentSetting: ParsedSetting | null = null;
  let currentSettingItem: ParsedSettingItem | null = null;
  let currentVolume: ParsedVolume | null = null;
  let currentPart: ParsedPart | null = null;

  // 缓冲区
  let settingItemContent: string[] = [];
  let partContent: string[] = [];
  let volumeNotesContent: string[] = [];
  let foreshadowContent: string[] = [];
  let currentMode: 'setting-item' | 'part' | 'volume-notes' | 'foreshadow' | 'none' = 'none';

  const flushSettingItem = () => {
    if (currentSetting && currentSettingItem) {
      currentSettingItem.content = settingItemContent.join('\n').trim();
      currentSetting.items.push(currentSettingItem);
    }
    currentSettingItem = null;
    settingItemContent = [];
  };

  const flushPart = () => {
    if (currentVolume && currentPart) {
      const raw = partContent.join('\n').trim();
      currentPart.content = DOMPurify.sanitize(textToHtml(raw));
      currentPart.wordCount = countWords(raw);
      currentVolume.parts.push(currentPart);
    }
    currentPart = null;
    partContent = [];
  };

  const flushVolumeNotes = () => {
    if (currentVolume) {
      currentVolume.notes = volumeNotesContent.join('\n').trim();
    }
    volumeNotesContent = [];
  };

  const flushForeshadow = () => {
    if (currentVolume && foreshadowContent.length > 0) {
      const desc = foreshadowContent.join('\n').trim();
      const fs: ParsedForeshadow = {
        title: `混沌双生·${currentVolume.title.split(/[：:·]/)[1]?.trim() || currentVolume.title}反噬`,
        description: desc,
        priority: 'medium',
      };
      currentVolume.foreshadows.push(fs);
      allForeshadows.push(fs);
    }
    foreshadowContent = [];
  };

  const flushAll = () => {
    flushForeshadow();
    flushVolumeNotes();
    flushPart();
    flushSettingItem();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跳过空行（但内容缓冲区需要保留段落分隔）
    if (trimmed === '') {
      if (currentMode === 'part') partContent.push('');
      else if (currentMode === 'setting-item') settingItemContent.push('');
      else if (currentMode === 'foreshadow') foreshadowContent.push('');
      else if (currentMode === 'volume-notes') volumeNotesContent.push('');
      continue;
    }

    // === 一级标题 # → 项目标题 ===
    const h1Match = trimmed.match(/^#\s+(.+)$/);
    if (h1Match) {
      flushAll();
      currentMode = 'none';
      titleFound = true;
      title = h1Match[1].trim()
        .replace(/^《(.+)》$/, '$1')
        .replace(/（.+）$/, '')
        .replace(/\(.+\)$/, '')
        .trim();
      continue;
    }

    // === 二级标题 ## ===
    const h2Match = trimmed.match(/^##\s+(.+)$/);
    if (h2Match) {
      flushAll();
      currentMode = 'none';
      const h2Text = h2Match[1].trim();

      // 判断是卷还是设定分类
      if (/^卷[一二三四五六七八九十\d]+/.test(h2Text) || /^第[一二三四五六七八九十\d]+卷/.test(h2Text)) {
        // 卷
        currentVolume = {
          title: h2Text,
          order: volumes.length,
          parts: [],
          foreshadows: [],
        };
        volumes.push(currentVolume);
      } else {
        // 设定分类（如"全书总纲"）
        currentSetting = {
          categoryName: h2Text,
          items: [],
        };
        settings.push(currentSetting);
      }
      continue;
    }

    // === 三级标题 ### ===
    const h3Match = trimmed.match(/^###\s+(.+)$/);
    if (h3Match) {
      flushAll();
      const h3Text = h3Match[1].trim();

      // 判断是部还是设定项
      if (currentVolume && /^(上部|中部|下部|上篇|中篇|下篇|开头|发展|高潮|结局|序幕|尾声)/.test(h3Text)) {
        // 部
        currentPart = {
          title: h3Text,
          order: currentVolume.parts.length,
          content: '',
          wordCount: 0,
        };
        currentMode = 'part';
      } else if (currentSetting) {
        // 设定项
        currentSettingItem = { name: h3Text, content: '' };
        currentMode = 'setting-item';
      } else if (currentVolume) {
        // 卷下的其他三级标题，作为部处理
        currentPart = {
          title: h3Text,
          order: currentVolume.parts.length,
          content: '',
          wordCount: 0,
        };
        currentMode = 'part';
      }
      continue;
    }

    // === 元数据行 **字段**：值 ===
    // 卷字数
    const wordCountVal = extractField(trimmed, '卷字数');
    if (wordCountVal && currentVolume) {
      currentVolume.wordTarget = parseWordCount(wordCountVal);
      metadataText += trimmed + '\n';
      continue;
    }
    // 时间跨度
    const timeSpanVal = extractField(trimmed, '时间跨度');
    if (timeSpanVal && currentVolume) {
      currentVolume.timeSpan = timeSpanVal;
      continue;
    }
    // 史诗定位
    const epicVal = extractField(trimmed, '史诗定位');
    if (epicVal && currentVolume) {
      currentVolume.epicPositioning = epicVal;
      continue;
    }
    // 核心命题
    const propVal = extractField(trimmed, '核心命题');
    if (propVal && currentVolume) {
      currentVolume.coreProposition = propVal;
      continue;
    }

    // === 特殊段落：混沌双生 / 卷末史诗落点 ===
    if (/^\*\*混沌双生/.test(trimmed) || /^\*\*.*反噬\*\*/.test(trimmed)) {
      flushForeshadow();
      flushPart();
      // 如果行内有内容（如"混沌双生·本卷反噬"标题行），开始收集
      currentMode = 'foreshadow';
      // 标题行本身可能带后续内容，检查下一行
      continue;
    }
    if (/^\*\*卷末史诗落点\*\*/.test(trimmed) || /^\*\*.*落点\*\*/.test(trimmed)) {
      flushPart();
      flushForeshadow();
      currentMode = 'volume-notes';
      continue;
    }

    // === 人物定位 / 寿数礼制等全局元数据（可能在总纲部分） ===
    // 兼容两种格式："**寿数礼制**：..." 和 "3. **寿数礼制**：..."
    // 这些行含人名与寿数信息，收集到 metadataText 供人物识别使用
    const globalMetaMatch = trimmed.match(/^(?:\d+\.\s*)?\*\*(人物定位|寿数礼制|核心精修|底层规则|意象定义|八卷结构)\*\*/);
    if (globalMetaMatch) {
      metadataText += trimmed + '\n';
      continue;
    }

    // === 总纲描述（核心立意等非结构化文本） ===
    // 仅在遇到 # 作品标题后、且不在任何卷/设定/部上下文时收集，
    // 排除文档开头的修改说明列表项（如"1. **八卷结构**：..."）
    if (titleFound && !currentVolume && !currentSetting && !currentPart) {
      if (description.length < 200 && !trimmed.startsWith('**') && !trimmed.startsWith('-') && !/^\d+\./.test(trimmed)) {
        description += (description ? ' ' : '') + trimmed;
      }
    }

    // === 内容分发到当前缓冲区 ===
    if (currentMode === 'part' && currentPart) {
      partContent.push(trimmed);
    } else if (currentMode === 'setting-item' && currentSettingItem) {
      settingItemContent.push(trimmed);
    } else if (currentMode === 'foreshadow') {
      foreshadowContent.push(trimmed);
    } else if (currentMode === 'volume-notes') {
      volumeNotesContent.push(trimmed);
    } else if (currentSetting && !currentSettingItem && !trimmed.startsWith('---')) {
      // 设定分类下的非标题内容，暂存为隐含设定项
      // 不做处理，避免噪音
    }
  }

  flushAll();

  // 提取人物（用截断后的 outlineText，避免对超大原文再次遍历）
  const characters = extractCharacters(outlineText, metadataText);

  // 计算总字数（各部字数之和）
  const totalWords = volumes.reduce((sum, v) =>
    sum + v.parts.reduce((s, p) => s + p.wordCount, 0), 0);

  // 如果描述为空，用核心立意替代
  if (!description && settings.length > 0 && settings[0].items.length > 0) {
    description = settings[0].items[0].content.slice(0, 200);
  }

  return {
    title: title || '导入大纲作品',
    description,
    volumes,
    characters,
    settings,
    foreshadows: allForeshadows,
    totalWords,
  };
}
