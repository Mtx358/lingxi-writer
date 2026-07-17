/**
 * 搜索 Worker：将全局搜索的计算从主线程迁移到 Web Worker
 * 解决百章以上规模作品搜索时主线程卡顿的问题
 */

interface SearchParams {
  query: string;
  chapters: Array<{ id: string; title: string; content: string; summary: string }>;
  characters: Array<{ id: string; name: string; profile: Record<string, unknown> }>;
  settingItems: Array<{ id: string; name: string; description: string; content: string }>;
  foreshadows: Array<{ id: string; title: string; description: string }>;
  materials: Array<{ id: string; title: string; content: string }>;
}

interface SearchResult {
  type: string;
  id: string;
  title: string;
  preview: string;
  matchCount: number;
}

// 转义正则元字符，防止用户输入触发 SyntaxError
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function executeSearch(params: SearchParams): SearchResult[] {
  const { query, chapters, characters, settingItems, foreshadows, materials } = params;
  if (!query.trim()) return [];

  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  const safePattern = new RegExp(escapeRegExp(lowerQuery), 'gi');

  chapters.forEach(c => {
    const plainContent = c.content.replace(/<[^>]*>/g, '');
    const titleMatches = (c.title.toLowerCase().match(safePattern) || []).length;
    const contentMatches = (plainContent.toLowerCase().match(safePattern) || []).length;
    const totalMatches = titleMatches * 3 + contentMatches;
    if (totalMatches > 0) {
      const idx = plainContent.toLowerCase().indexOf(lowerQuery);
      const preview = idx >= 0
        ? (idx > 20 ? '...' : '') + plainContent.slice(Math.max(0, idx - 20), idx + query.length + 30) + (idx + query.length + 30 < plainContent.length ? '...' : '')
        : c.summary;
      results.push({ type: 'chapter', id: c.id, title: c.title, preview, matchCount: totalMatches });
    }
  });

  characters.forEach(c => {
    const nameMatches = (c.name.toLowerCase().match(safePattern) || []).length;
    const profileStr = JSON.stringify(c.profile).toLowerCase();
    const profileMatches = (profileStr.match(safePattern) || []).length;
    const totalMatches = nameMatches * 5 + profileMatches;
    if (totalMatches > 0) {
      const personality = (c.profile as Record<string, string>).personality || (c.profile as Record<string, string>).background || '';
      results.push({ type: 'character', id: c.id, title: c.name, preview: personality, matchCount: totalMatches });
    }
  });

  settingItems.forEach(s => {
    const nameMatches = (s.name.toLowerCase().match(safePattern) || []).length;
    const descMatches = (s.description.toLowerCase().match(safePattern) || []).length;
    const contentMatches = (s.content.toLowerCase().match(safePattern) || []).length;
    const totalMatches = nameMatches * 3 + descMatches * 2 + contentMatches;
    if (totalMatches > 0) {
      results.push({ type: 'setting', id: s.id, title: s.name, preview: s.description, matchCount: totalMatches });
    }
  });

  foreshadows.forEach(f => {
    const titleMatches = (f.title.toLowerCase().match(safePattern) || []).length;
    const descMatches = (f.description.toLowerCase().match(safePattern) || []).length;
    const totalMatches = titleMatches * 3 + descMatches;
    if (totalMatches > 0) {
      results.push({ type: 'foreshadow', id: f.id, title: f.title, preview: f.description, matchCount: totalMatches });
    }
  });

  materials.forEach(m => {
    const titleMatches = (m.title.toLowerCase().match(safePattern) || []).length;
    const contentMatches = (m.content.toLowerCase().match(safePattern) || []).length;
    const totalMatches = titleMatches * 3 + contentMatches;
    if (totalMatches > 0) {
      const idx = m.content.toLowerCase().indexOf(lowerQuery);
      const preview = idx >= 0
        ? (idx > 20 ? '...' : '') + m.content.slice(Math.max(0, idx - 20), idx + query.length + 30) + (idx + query.length + 30 < m.content.length ? '...' : '')
        : m.content.slice(0, 80) + '...';
      results.push({ type: 'material', id: m.id, title: m.title, preview, matchCount: totalMatches });
    }
  });

  results.sort((a, b) => b.matchCount - a.matchCount);
  return results;
}

self.onmessage = (e: MessageEvent<SearchParams>) => {
  const results = executeSearch(e.data);
  (self as unknown as Worker).postMessage(results);
};
