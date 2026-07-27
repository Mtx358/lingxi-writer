/**
 * searchWorker 测试
 *
 * 直接测试导出的 executeSearch 纯函数，覆盖五类实体的搜索：
 *   - chapter（title + content，HTML 标签剥离）
 *   - character（name + profile JSON）
 *   - settingItem（name + description + content）
 *   - foreshadow（title + description）
 *   - material（title + content）
 *
 * 不变量：
 *   - 空 query 返回 []
 *   - 标题命中权重高于内容命中（chapter: title×3 vs content×1，character: name×5）
 *   - 结果按 matchCount 降序
 *   - 用户输入的特殊正则元字符（如 .*?）被转义，不破坏搜索
 *   - preview 生成：idx>20 时前缀 ...，结尾超长时后缀 ...
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeSearch, type SearchParams, type SearchResult } from './searchWorker';

function makeParams(overrides: Partial<SearchParams> = {}): SearchParams {
  return {
    query: 'test',
    chapters: [],
    characters: [],
    settingItems: [],
    foreshadows: [],
    materials: [],
    ...overrides,
  };
}

describe('executeSearch', () => {
  it('空 query 返回空数组', () => {
    const result = executeSearch(makeParams({ query: '   ' }));
    expect(result).toEqual([]);
  });

  it('空 query（仅空白）也返回空数组', () => {
    const result = executeSearch(makeParams({ query: '\t\n' }));
    expect(result).toEqual([]);
  });

  // -------------------- chapter --------------------
  it('chapter：title 命中权重 ×3，content 命中权重 ×1', () => {
    const result = executeSearch(makeParams({
      query: 'test',
      chapters: [
        // title 含 1 次 test：matchCount = 1*3 = 3
        { id: 'c1', title: 'test chapter', content: '内容', summary: '' },
        // content 含 2 次 test：matchCount = 2*1 = 2
        { id: 'c2', title: '其他', content: 'test test 正文', summary: '' },
      ],
    }));
    expect(result).toHaveLength(2);
    // 按 matchCount 降序：c1 (3) 在前，c2 (2) 在后
    expect(result[0].id).toBe('c1');
    expect(result[0].matchCount).toBe(3);
    expect(result[1].id).toBe('c2');
    expect(result[1].matchCount).toBe(2);
    expect(result[0].type).toBe('chapter');
  });

  it('chapter：HTML 标签被剥离后再匹配', () => {
    const result = executeSearch(makeParams({
      query: '关键词',
      chapters: [
        { id: 'c1', title: '标题', content: '<p>这里有<em>关键词</em>出现</p>', summary: '' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].matchCount).toBe(1);
  });

  it('chapter：content 命中时 preview 含匹配文本前后片段', () => {
    const result = executeSearch(makeParams({
      query: '关键词',
      chapters: [
        // idx = 5（"前面一些内容"长度），> 0 不 > 20，所以前缀不加 ...
        // 实际：'前面一些内容' = 6 字符，加 "关键词" = 9，再加 30 字符后缀
        { id: 'c1', title: '标题', content: '前面一些内容关键词后面一些内容后面一些内容后面一些内容', summary: 'fallback' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].preview).toContain('关键词');
  });

  it('chapter：仅 title 命中时 preview 回退为 summary', () => {
    const result = executeSearch(makeParams({
      query: '标题词',
      chapters: [
        { id: 'c1', title: '标题词', content: '正文不含关键词', summary: '摘要内容' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].preview).toBe('摘要内容');
  });

  it('chapter：content 命中位置 idx > 20 时 preview 前缀加 ...', () => {
    const longPrefix = '前'.repeat(50);
    const result = executeSearch(makeParams({
      query: '关键词',
      chapters: [
        { id: 'c1', title: '标题', content: `${longPrefix}关键词`, summary: 'fallback' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].preview.startsWith('...')).toBe(true);
    expect(result[0].preview).toContain('关键词');
  });

  it('chapter：content 命中且后缀超出时 preview 末尾加 ...', () => {
    const longSuffix = '后'.repeat(100);
    const result = executeSearch(makeParams({
      query: '关键词',
      chapters: [
        { id: 'c1', title: '标题', content: `关键词${longSuffix}`, summary: 'fallback' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].preview).toContain('关键词');
    expect(result[0].preview.endsWith('...')).toBe(true);
  });

  // -------------------- character --------------------
  it('character：name 命中权重 ×5，profile 命中权重 ×1', () => {
    const result = executeSearch(makeParams({
      query: '刘备',
      characters: [
        // name 含 1 次：matchCount = 1*5 = 5
        { id: 'char1', name: '刘备', profile: { background: '其他描述' } },
        // profile 含 2 次：matchCount = 2*1 = 2
        { id: 'char2', name: '其他', profile: { background: '刘备刘备 出现两次' } },
      ],
    }));
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('char1');
    expect(result[0].matchCount).toBe(5);
    expect(result[1].id).toBe('char2');
    expect(result[1].matchCount).toBe(2);
    expect(result[0].type).toBe('character');
  });

  it('character：preview 优先取 personality，否则取 background', () => {
    const result = executeSearch(makeParams({
      query: '刘备',
      characters: [
        // 同时有 personality 与 background，preview 应取 personality
        { id: 'char1', name: '刘备', profile: { personality: '冷静', background: '背景' } },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].preview).toBe('冷静');
  });

  it('character：无 personality 时 preview 取 background', () => {
    const result = executeSearch(makeParams({
      query: '刘备',
      characters: [
        { id: 'char1', name: '刘备', profile: { background: '背景信息' } },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].preview).toBe('背景信息');
  });

  it('character：profile 为空对象时 preview 为空字符串', () => {
    const result = executeSearch(makeParams({
      query: '刘备',
      characters: [
        { id: 'char1', name: '刘备', profile: {} },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].preview).toBe('');
  });

  // -------------------- settingItem --------------------
  it('settingItem：name ×3 + description ×2 + content ×1', () => {
    const result = executeSearch(makeParams({
      query: '关键词',
      settingItems: [
        // name ×1 + desc ×1 + content ×1 = 3+2+1 = 6
        {
          id: 's1', name: '关键词名', description: '关键词描述', content: '关键词内容',
        },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].matchCount).toBe(6);
    expect(result[0].type).toBe('setting');
    // preview 取 description
    expect(result[0].preview).toBe('关键词描述');
  });

  it('settingItem：仅 content 命中', () => {
    const result = executeSearch(makeParams({
      query: '关键词',
      settingItems: [
        { id: 's1', name: '名称', description: '描述', content: '关键词出现一次' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].matchCount).toBe(1);
  });

  // -------------------- foreshadow --------------------
  it('foreshadow：title ×3 + description ×1', () => {
    const result = executeSearch(makeParams({
      query: '伏笔',
      foreshadows: [
        { id: 'f1', title: '伏笔标题', description: '伏笔描述' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].matchCount).toBe(4); // 3 + 1
    expect(result[0].type).toBe('foreshadow');
    expect(result[0].preview).toBe('伏笔描述');
  });

  it('foreshadow：仅 title 命中', () => {
    const result = executeSearch(makeParams({
      query: '特殊',
      foreshadows: [
        { id: 'f1', title: '特殊标题', description: '普通描述' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].matchCount).toBe(3);
  });

  // -------------------- material --------------------
  it('material：title ×3 + content ×1', () => {
    const result = executeSearch(makeParams({
      query: '素材',
      materials: [
        { id: 'm1', title: '素材标题', content: '素材内容' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].matchCount).toBe(4);
    expect(result[0].type).toBe('material');
  });

  it('material：content 命中时 preview 取匹配前后片段', () => {
    const result = executeSearch(makeParams({
      query: '素材',
      materials: [
        { id: 'm1', title: '标题', content: '前置内容素材后置内容' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].preview).toContain('素材');
  });

  it('material：仅 title 命中时 preview 取 content 前 80 字符 + ...', () => {
    const result = executeSearch(makeParams({
      query: '特殊标题',
      materials: [
        { id: 'm1', title: '特殊标题', content: '纯内容' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].preview.endsWith('...')).toBe(true);
    expect(result[0].preview).toContain('纯内容');
  });

  // -------------------- 综合 --------------------
  it('多类型混合：按 matchCount 全局降序排序', () => {
    const result = executeSearch(makeParams({
      query: 'x',
      chapters: [
        { id: 'c1', title: 'x', content: 'x x x x', summary: '' }, // 3 + 4 = 7
      ],
      characters: [
        { id: 'char1', name: 'x', profile: {} }, // 5
      ],
      settingItems: [
        { id: 's1', name: 'x', description: 'x', content: 'x' }, // 3 + 2 + 1 = 6
      ],
      foreshadows: [
        { id: 'f1', title: 'x', description: 'x' }, // 4
      ],
      materials: [
        { id: 'm1', title: 'x', content: 'x' }, // 4
      ],
    }));
    expect(result).toHaveLength(5);
    // 按 matchCount 降序：7 > 6 > 5 > 4 = 4
    expect(result[0].matchCount).toBeGreaterThanOrEqual(result[1].matchCount);
    expect(result[1].matchCount).toBeGreaterThanOrEqual(result[2].matchCount);
    expect(result[2].matchCount).toBeGreaterThanOrEqual(result[3].matchCount);
    expect(result[3].matchCount).toBeGreaterThanOrEqual(result[4].matchCount);
    // 最高分应为 chapter（matchCount=7）
    expect(result[0].type).toBe('chapter');
    expect(result[0].matchCount).toBe(7);
  });

  it('正则元字符（.*?+^${}()|[]\\）被转义，不破坏搜索', () => {
    // 用户输入 "(test)" 含正则元字符，应作为字面字符匹配
    const result = executeSearch(makeParams({
      query: '(test)',
      chapters: [
        { id: 'c1', title: '(test) literal', content: '', summary: '' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('大小写不敏感匹配', () => {
    const result = executeSearch(makeParams({
      query: 'TEST',
      chapters: [
        { id: 'c1', title: 'test chapter', content: 'TEST content', summary: '' },
      ],
    }));
    expect(result).toHaveLength(1);
    // title 匹配 1 次（小写）+ content 匹配 1 次（大写）= 3 + 1 = 4
    expect(result[0].matchCount).toBe(4);
  });

  it('所有实体均无命中时返回空数组', () => {
    const result = executeSearch(makeParams({
      query: '不存在的关键词',
      chapters: [
        { id: 'c1', title: '其他', content: '其他', summary: '' },
      ],
      characters: [
        { id: 'char1', name: '其他', profile: {} },
      ],
    }));
    expect(result).toEqual([]);
  });

  it('多次命中同一字段时计数准确', () => {
    const result = executeSearch(makeParams({
      query: '关键词',
      chapters: [
        // content 含 3 次"关键词"
        { id: 'c1', title: '其他', content: '关键词 关键词 关键词', summary: '' },
      ],
    }));
    expect(result).toHaveLength(1);
    // 3 次 content 命中 × 1 = 3
    expect(result[0].matchCount).toBe(3);
  });

  // -------------------- 缓存命中（覆盖 getChapterPlain / getProfileStr cache-hit 分支 L35/L43） --------------------
  it('chapter 缓存命中：同一 chapter id+content 二次搜索直接返回缓存纯文本', () => {
    const params = makeParams({
      query: '关键词',
      chapters: [{ id: 'cache-c', title: '标题', content: '关键词正文', summary: '' }],
    });
    executeSearch(params); // 首次：cache miss → 填充缓存
    const result = executeSearch(params); // 二次：cache hit → 直接返回 cached.plain
    expect(result).toHaveLength(1);
    expect(result[0].matchCount).toBe(1);
  });

  it('character 缓存命中：同一 character id+profile 引用二次搜索直接返回缓存文本', () => {
    const profile = { background: '关键词背景' };
    const params = makeParams({
      query: '关键词',
      characters: [{ id: 'cache-p', name: '其他', profile }],
    });
    executeSearch(params); // 首次：cache miss → JSON.stringify + 填充缓存
    const result = executeSearch(params); // 二次：cache hit → 直接返回 cached.str
    expect(result).toHaveLength(1);
    expect(result[0].matchCount).toBe(1);
  });

  // -------------------- || 短路分支覆盖 --------------------
  it('setting：content 不匹配时 || [] 右侧被取（覆盖 L99 || 假分支）', () => {
    // name + description 匹配但 content 不匹配，覆盖 contentMatches 的 || falsy 分支
    const result = executeSearch(makeParams({
      query: '关键词',
      settingItems: [
        { id: 's1', name: '关键词名', description: '关键词描述', content: '完全不相关的内容' },
      ],
    }));
    expect(result).toHaveLength(1);
    // name×3 + desc×2 = 5（content 不匹配）
    expect(result[0].matchCount).toBe(5);
  });

  it('foreshadow：title 不匹配时 || [] 右侧被取（覆盖 L107 || 假分支）', () => {
    // description 匹配但 title 不匹配，覆盖 titleMatches 的 || falsy 分支
    const result = executeSearch(makeParams({
      query: '关键词',
      foreshadows: [
        { id: 'f1', title: '普通标题', description: '关键词描述' },
      ],
    }));
    expect(result).toHaveLength(1);
    // desc×1 = 1（title 不匹配）
    expect(result[0].matchCount).toBe(1);
  });

  // -------------------- material preview 内部三元分支覆盖 --------------------
  it('material：content 命中 idx>20 时 preview 前缀加 ...', () => {
    const longPrefix = '前'.repeat(50);
    const result = executeSearch(makeParams({
      query: '关键词',
      materials: [
        { id: 'm1', title: '标题', content: `${longPrefix}关键词短后缀` },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].preview.startsWith('...')).toBe(true);
    expect(result[0].preview).toContain('关键词');
  });

  it('material：content 命中且后缀超出时 preview 末尾加 ...', () => {
    const longSuffix = '后'.repeat(100);
    const result = executeSearch(makeParams({
      query: '关键词',
      materials: [
        { id: 'm1', title: '标题', content: `关键词${longSuffix}` },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].preview.endsWith('...')).toBe(true);
    expect(result[0].preview).toContain('关键词');
  });
});

// -------------------- self.onmessage --------------------
// searchWorker 模块加载时会将 self.onmessage 绑定为消息处理函数。
// 这里通过直接调用绑定的 self.onmessage(event) 来覆盖 onmessage 的 try/catch 分支，
// 并 mock self.postMessage 以断言回传结果（jsdom 下 self.postMessage 是 window.postMessage，
// 直接调用会向自身派发 message 事件，需替换为 spy）。
describe('self.onmessage', () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let originalPostMessage: unknown;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    originalPostMessage = (self as unknown as { postMessage: unknown }).postMessage;
    // 替换 self.postMessage 为 spy，避免 jsdom 的 window.postMessage 向自身派发事件
    (self as unknown as { postMessage: unknown }).postMessage = postMessageSpy;
    // catch 分支会 console.error，静默以免污染测试输出
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (self as unknown as { postMessage: unknown }).postMessage = originalPostMessage;
    consoleErrorSpy.mockRestore();
  });

  // onmessage 在模块加载时已绑定到 self.onmessage
  const onmessage = (): ((e: { data: unknown }) => void) => (self as unknown as { onmessage: (e: { data: unknown }) => void }).onmessage;

  it('正常搜索：回传 requestId + results', () => {
    onmessage()({
      data: {
        requestId: 42,
        query: 'test',
        chapters: [{ id: 'c1', title: 'test chapter', content: '', summary: '' }],
        characters: [],
        settingItems: [],
        foreshadows: [],
        materials: [],
      },
    });
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const payload = postMessageSpy.mock.calls[0][0] as { requestId: number; results: SearchResult[] };
    expect(payload.requestId).toBe(42);
    expect(Array.isArray(payload.results)).toBe(true);
    expect(payload.results.length).toBeGreaterThan(0);
  });

  it('executeSearch 抛 Error（chapters 缺失）：回传 requestId + error.message（instanceof Error 真分支）', () => {
    // 不传 chapters → pruneCaches 调用 undefined.map 抛 TypeError（Error 子类）
    onmessage()({
      data: {
        requestId: 99,
        query: 'x',
        characters: [],
        settingItems: [],
        foreshadows: [],
        materials: [],
      },
    });
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const payload = postMessageSpy.mock.calls[0][0] as { requestId: number; error: string };
    expect(payload.requestId).toBe(99);
    expect(payload.error).toBeTypeOf('string');
    expect(payload.error.length).toBeGreaterThan(0);
  });

  it('executeSearch 抛非 Error：error 字段为 String(err)（instanceof Error 假分支）', () => {
    // chapters.map 抛出字符串（非 Error），覆盖 catch 中 instanceof Error 的 false 分支
    onmessage()({
      data: {
        requestId: 100,
        query: 'x',
        chapters: { map: () => { throw 'non-error string'; } },
        characters: [],
        settingItems: [],
        foreshadows: [],
        materials: [],
      },
    });
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const payload = postMessageSpy.mock.calls[0][0] as { requestId: number; error: string };
    expect(payload.requestId).toBe(100);
    expect(payload.error).toBe('non-error string');
  });
});
