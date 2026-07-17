import type { Chapter, Character, SettingItem, ConflictIssue } from '@/types';
import { generateId } from './storage';

export class ConflictDetector {
  private characters: Character[] = [];
  private settings: SettingItem[] = [];

  setCharacters(characters: Character[]) {
    this.characters = characters;
  }

  setSettings(settings: SettingItem[]) {
    this.settings = settings;
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
        const occurrences = (fullText.match(new RegExp(this.escapeRegExp(variant), 'g')) || []).length;
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

    // 3. 设定引用检查
    this.settings.forEach(setting => {
      const keywords = this.extractKeywords(setting);
      let mentionedCount = 0;
      keywords.forEach(kw => {
        if (fullText.includes(kw)) mentionedCount++;
      });

      // 如果设定名称出现在文本中，但相关关键信息没有提及
      if (fullText.includes(setting.name) && mentionedCount < 1) {
        // 仅作为 info 级别的提示
      }
    });

    // 4. 时间线/年龄简单检测
    this.characters.forEach(char => {
      if (char.profile.age && fullText.includes(char.name)) {
        // 检查文本中是否有冲突的年龄描述（简化检测）
      }
    });

    // 5. 角色出场但无对话/动作提示
    this.characters.forEach(char => {
      if (fullText.includes(char.name)) {
        const nameCount = (fullText.match(new RegExp(this.escapeRegExp(char.name), 'g')) || []).length;
        if (nameCount > 3 && nameCount < 10) {
          // 适度出场，检查是否有对话或动作
          const dialoguePattern = new RegExp(`${this.escapeRegExp(char.name)}[^。！？]{0,10}[："]`, 'g');
          const hasDialogue = dialoguePattern.test(fullText);
          if (!hasDialogue && nameCount > 5) {
            // 可以提示角色出场较多但缺少对话
          }
        }
      }
    });

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
        const totalChapters = chapters.filter(c => c.level === 2).length;
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

  private extractKeywords(setting: SettingItem): string[] {
    const keywords: string[] = [];
    const words = setting.description.match(/[\u4e00-\u9fa5]{2,4}/g);
    if (words) {
      keywords.push(...words.slice(0, 5));
    }
    return keywords;
  }
}

export const conflictDetector = new ConflictDetector();
