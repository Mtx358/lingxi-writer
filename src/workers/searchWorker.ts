/**
 * 搜索 Worker：将全局搜索的计算从主线程迁移到 Web Worker
 * 解决百章以上规模作品搜索时主线程卡顿的问题
 */

export interface SearchParams {
  query: string;
  chapters: Array<{ id: string; title: string; content: string; summary: string }>;
  characters: Array<{ id: string; name: string; profile: Record<string, unknown> }>;
  settingItems: Array<{ id: string; name: string; description: string; content: string }>;
  foreshadows: Array<{ id: string; title: string; description: string }>;
  materials: Array<{ id: string; title: string; content: string }>;
}

export interface SearchResult {
  type: string;
  id: string;
  title: string;
  preview: string;
  matchCount: number;
}

// 转义正则元字符，防止用户输入触发 SyntaxError
// 注：刻意保留独立副本而非 import @/lib/regexUtils——Worker 运行在隔离上下文，
// 引入主线程模块会拉入额外依赖、增大 Worker 打包体积；此处单行实现零依赖更合适
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// H2 性能修复：Worker 内缓存章节纯文本与角色 profile 字符串，避免每次搜索重复去 HTML + JSON.stringify
// 主线程的 chapterPlainTextCache / profileSearchCache 仅存在于主线程，Worker 内需独立维护
const workerChapterCache = new Map<string, { content: string; plain: string }>();
const workerProfileCache = new Map<string, { profileRef: unknown; str: string }>();

const getChapterPlain = (id: string, content: string): string => {
  const cached = workerChapterCache.get(id);
  if (cached && cached.content === content) return cached.plain;
  const plain = (content || '').replace(/<[^>]*>/g, '');
  workerChapterCache.set(id, { content, plain });
  return plain;
};

const getProfileStr = (id: string, profile: unknown): string => {
  const cached = workerProfileCache.get(id);
  if (cached && cached.profileRef === profile) return cached.str;
  const str = JSON.stringify(profile).toLowerCase();
  workerProfileCache.set(id, { profileRef: profile, str });
  return str;
};

// 清理已删除实体的缓存条目，避免缓存无限增长
const pruneCaches = (chapters: SearchParams['chapters'], characters: SearchParams['characters']) => {
  const chapterIds = new Set(chapters.map(c => c.id));
  const charIds = new Set(characters.map(c => c.id));
  for (const id of workerChapterCache.keys()) {
    if (!chapterIds.has(id)) workerChapterCache.delete(id);
  }
  for (const id of workerProfileCache.keys()) {
    if (!charIds.has(id)) workerProfileCache.delete(id);
  }
};

export function executeSearch(params: SearchParams): SearchResult[] {
  const { query, chapters, characters, settingItems, foreshadows, materials } = params;
  if (!query.trim()) return [];

  pruneCaches(chapters, characters);

  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  const safePattern = new RegExp(escapeRegExp(lowerQuery), 'gi');

  chapters.forEach(c => {
    const plainContent = getChapterPlain(c.id, c.content);
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
    const profileStr = getProfileStr(c.id, c.profile);
    const profileMatches = (profileStr.match(safePattern) || []).length;
    const totalMatches = nameMatches * 5 + profileMatches;
    if (totalMatches > 0) {
      // profile 声明为 Record<string, unknown>，不可直接 as Record<string, string>：
      // 字段值可能是数字/对象/数组。按字段 typeof 守卫取字符串，避免类型谎言
      const profileFieldStr = (key: string): string => {
        const v = c.profile[key];
        return typeof v === 'string' ? v : '';
      };
      const personality = profileFieldStr('personality') || profileFieldStr('background');
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

self.onmessage = (e: MessageEvent<SearchParams & { requestId: number }>) => {
  try {
    // 拆出 requestId 后再将剩余参数交给 executeSearch，避免 requestId 污染搜索逻辑
    const { requestId, ...params } = e.data;
    const results = executeSearch(params);
    // 回传 requestId：主线程据此丢弃过期请求的结果，避免并发搜索时错配响应
    (self as unknown as Worker).postMessage({ requestId, results });
  } catch (err) {
    // Worker 内未捕获异常会让 Worker 卡死，主线程无超时机制。
    // 捕获后回传 error（携带 requestId），主线程可据此降级到主线程搜索
    const { requestId } = e.data;
    console.error('searchWorker executeSearch failed:', err);
    (self as unknown as Worker).postMessage({
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
