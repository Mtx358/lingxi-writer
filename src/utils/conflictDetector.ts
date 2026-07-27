import type { Chapter, Character, SettingItem, ConflictIssue } from '@/types';
import { generateId } from './storage';

export class ConflictDetector {
  private characters: Character[] = [];
  private settings: SettingItem[] = [];
  // RegExp 缓存：detectChapterConflicts 对每章每个角色变体都新建正则，
  // 频繁调用时 GC 压力大；缓存按 variant 字符串复用，setCharacters 时清空
  private regexCache = new Map<string, RegExp>();

  setCharacters(characters: Character[]) {
    this.characters = characters;
    // 角色变更后缓存可能失效（旧变体不再需要），清空避免内存增长
    this.regexCache.clear();
  }

  setSettings(settings: SettingItem[]) {
    this.settings = settings;
  }

  private getCachedRegExp(pattern: string): RegExp {
    let re = this.regexCache.get(pattern);
    if (!re) {
      re = new RegExp(this.escapeRegExp(pattern), 'g');
      this.regexCache.set(pattern, re);
    }
    // reset lastIndex（全局正则复用时必须）
    re.lastIndex = 0;
    return re;
  }

  detectChapterConflicts(chapter: Chapter): ConflictIssue[] {
    const issues: ConflictIssue[] = [];
    const fullText = chapter.content.replace(/<[^>]*>/g, '');

    // 去除对话内容（引号包围部分），用于人称统计，避免对话中"我/他"造成误判
    const nonDialogueText = this.stripDialogue(fullText);

    // 1. 角色名拼写一致性检查
    this.characters.forEach(char => {
      const nameVariants = this.generateNameVariants(char.name);
      nameVariants.forEach(variant => {
        if (variant === char.name || !fullText.includes(variant)) return;
        // 排除与其他角色全名冲突的变体（如"小明"已是另一角色全名，则不应作为"赵小明"的变体报警）
        const conflictsWithOther = this.characters.some(other =>
          other.id !== char.id && other.name === variant
        );
        if (conflictsWithOther) return;
        // 要求出现次数 >= 2 才报警，避免偶然出现造成的噪音
        const occurrences = (fullText.match(this.getCachedRegExp(variant)) || []).length;
        if (occurrences < 2) return;

        const pos = fullText.indexOf(variant);
        issues.push({
          id: generateId(),
          type: 'character',
          severity: 'warning',
          chapterId: chapter.id,
          description: `可能的角色名不一致："${variant}" 与标准名称 "${char.name}" 相似（出现 ${occurrences} 次）`,
          suggestion: '确认是否为同一角色，建议统一角色名称',
          position: { start: pos, end: pos + variant.length },
          resolved: false,
        });
      });
    });

    // 2. 人称一致性检测（基于非对话文本，避免对话中第一/第三人称造成误判）
    const firstPersonCount = (nonDialogueText.match(/我|我的|我们|我们的/g) || []).length;
    const thirdPersonCount = (nonDialogueText.match(/他|她|它|他们|她们/g) || []).length;
    const totalChars = nonDialogueText.length;

    if (totalChars > 500 && firstPersonCount > 10 && thirdPersonCount > 10) {
      const ratio = firstPersonCount / (firstPersonCount + thirdPersonCount);
      // 收紧混用判定阈值（0.3-0.7），仅在明显混用时才报警
      if (ratio > 0.3 && ratio < 0.7) {
        issues.push({
          id: generateId(),
          type: 'style',
          severity: 'warning',
          chapterId: chapter.id,
          description: '人称可能不一致：第一人称和第三人称混用（已剔除对话）',
          suggestion: '检查叙事视角是否统一，避免第一人称和第三人称频繁切换',
          resolved: false,
        });
      }
    }

    // 3. 设定引用一致性：章节中提及了某个设定项的名称，但与之相关的关键词
    //    （取自设定 description 的 2-4 字中文词组）未出现，可能存在设定信息遗漏。
    //    仅作 info 级提示，避免误报。
    this.settings.forEach(setting => {
      if (!setting.name || !fullText.includes(setting.name)) return;
      const keywords = (setting.description || '').match(/[\u4e00-\u9fa5]{2,4}/g) || [];
      const missingKeyword = keywords.find(kw => kw !== setting.name && !fullText.includes(kw));
      if (missingKeyword) {
        issues.push({
          id: generateId(),
          type: 'setting',
          severity: 'info',
          chapterId: chapter.id,
          description: `设定「${setting.name}」被引用，但关键词「${missingKeyword}」未在本章出现`,
          suggestion: '检查是否需要补充该设定的关键信息，以保证读者理解一致',
          resolved: false,
        });
      }
    });

    // 4-5. 以下检测项暂未实现（原 if 分支为空，已删除以避免死代码误导）：
    //   - 时间线/年龄：文本与角色 profile.age 冲突的年龄描述
    //   - 角色出场无对话：角色出场较多但缺少对话/动作标签
    // 如需启用，可在此处基于 this.characters 补全实现并 push 到 issues。

    return issues;
  }

  detectGlobalConflicts(chapters: Chapter[]): ConflictIssue[] {
    const issues: ConflictIssue[] = [];

    // 跨章节的一致性检测
    const characterAppearances: Record<string, string[]> = {};

    chapters.forEach(chapter => {
      const text = chapter.content.replace(/<[^>]*>/g, '');
      this.characters.forEach(char => {
        if (text.includes(char.name)) {
          if (!characterAppearances[char.id]) {
            characterAppearances[char.id] = [];
          }
          characterAppearances[char.id].push(chapter.id);
        }
      });
    });

    // 检测角色突然消失
    this.characters.forEach(char => {
      const appearances = characterAppearances[char.id] || [];
      if (appearances.length > 0 && char.role === 'protagonist') {
        const lastAppearanceIdx = chapters.findIndex(c => c.id === appearances[appearances.length - 1]);
        const totalChapters = chapters.filter(c => c.levelType === 'chapter').length;
        if (totalChapters - lastAppearanceIdx > 3 && lastAppearanceIdx < totalChapters - 1) {
          issues.push({
            id: generateId(),
            type: 'character',
            severity: 'info',
            chapterId: appearances[appearances.length - 1],
            description: `角色"${char.name}"已经连续 ${totalChapters - lastAppearanceIdx - 1} 章没有出场了`,
            suggestion: '如果不是故意安排，考虑给该角色一些戏份，或者解释其缺席的原因',
            resolved: false,
          });
        }
      }
    });

    return issues;
  }

  private generateNameVariants(name: string): string[] {
    const variants: string[] = [];
    if (name.length === 2) {
      // 两字名可能的变体
      variants.push(name[0] + '哥');
      variants.push(name[0] + '姐');
      variants.push('小' + name[0]);
      variants.push('老' + name[0]);
    } else if (name.length === 3) {
      // 三字名可能只叫后面两个字
      variants.push(name.slice(1));
      variants.push(name[0] + name[1]);
    }
    return variants.slice(0, 3);
  }

  // 转义正则元字符，与 store 内同名工具保持一致语义
  private escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 去除对话内容（中英文引号配对包围的部分），降低对话中第一/第三人称的误判
  private stripDialogue(text: string): string {
    return text
      .replace(/"[^"]*"/g, '')
      .replace(/"[^"]*"/g, '')
      .replace(/"[^"]*"/g, '')
      .replace(/「[^」]*」/g, '')
      .replace(/『[^』]*』/g, '');
  }
}

export const conflictDetector = new ConflictDetector();
