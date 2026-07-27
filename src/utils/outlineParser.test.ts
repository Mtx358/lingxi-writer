/**
 * outlineParser 测试
 *
 * 覆盖 parseOutline 的核心解析路径：
 *   - 标题 / 描述 / 卷 / 部 / 设定分类 / 设定项 解析
 *   - 卷元数据（卷字数 / 时间跨度 / 史诗定位 / 核心命题）
 *   - 卷末史诗落点 notes 收集
 *   - 混沌双生伏笔自动归入当前卷
 *   - 人物识别（KNOWN_FIGURES 命中 + 元数据提取）
 *   - 描述前缀过滤（文档开头的修改说明不被误识为描述）
 *   - 字数累加（totalWords = 各部字数之和）
 */
import { describe, it, expect } from 'vitest';
import { parseOutline } from './outlineParser';

describe('parseOutline', () => {
  it('一级标题 # 《XXX》 提取作品名（剥离书名号）', () => {
    const text = `# 《我的小说》

## 卷一 开端

### 上部 启程

内容一。
`;
    const result = parseOutline(text);
    expect(result.title).toBe('我的小说');
  });

  it('一级标题带 （注释） 后缀时书名号不被剥离（保留行为）', () => {
    // 当前实现：replace 顺序为先剥《》$ 后剥（注释），若尾部带（注释）则《》不匹配首尾
    // 最终 title 保留书名号，验证此行为防回退
    const text = `# 《我的小说》（试作）

## 卷一

### 上部

内容。
`;
    const result = parseOutline(text);
    expect(result.title).toBe('《我的小说》');
  });

  it('一级标题无书名号时直接取文本', () => {
    const text = `# 我的小说

## 卷一

### 上部

内容。
`;
    const result = parseOutline(text);
    expect(result.title).toBe('我的小说');
  });

  it('卷（## 卷X）与部（### 上部）层级正确', () => {
    const text = `# 作品

## 卷一 开端

### 上部 启程

上部内容。

### 下部 转折

下部内容。
`;
    const result = parseOutline(text);
    expect(result.volumes).toHaveLength(1);
    expect(result.volumes[0].title).toBe('卷一 开端');
    expect(result.volumes[0].order).toBe(0);
    expect(result.volumes[0].parts).toHaveLength(2);
    expect(result.volumes[0].parts[0].title).toBe('上部 启程');
    expect(result.volumes[0].parts[0].order).toBe(0);
    expect(result.volumes[0].parts[1].title).toBe('下部 转折');
    expect(result.volumes[0].parts[1].order).toBe(1);
  });

  it('第X卷 格式也识别为卷', () => {
    const text = `# 作品

## 第一卷 起源

### 上部

内容。
`;
    const result = parseOutline(text);
    expect(result.volumes).toHaveLength(1);
    expect(result.volumes[0].title).toBe('第一卷 起源');
  });

  it('卷元数据：卷字数 / 时间跨度 / 史诗定位 / 核心命题', () => {
    const text = `# 作品

## 卷一

**卷字数**：80万字
**时间跨度**：公元 220-225 年
**史诗定位**：奠基
**核心命题**：天下归心

### 上部

内容。
`;
    const result = parseOutline(text);
    expect(result.volumes[0].wordTarget).toBe(800000);
    expect(result.volumes[0].timeSpan).toBe('公元 220-225 年');
    expect(result.volumes[0].epicPositioning).toBe('奠基');
    expect(result.volumes[0].coreProposition).toBe('天下归心');
  });

  it('卷字数格式 "80万" 与 "800000" 均解析为 800000', () => {
    const text1 = `# 作品

## 卷一

**卷字数**：80万

### 上部

内容。
`;
    expect(parseOutline(text1).volumes[0].wordTarget).toBe(800000);

    const text2 = `# 作品

## 卷一

**卷字数**：800000

### 上部

内容。
`;
    expect(parseOutline(text2).volumes[0].wordTarget).toBe(800000);
  });

  it('卷末史诗落点 收集为 volume.notes', () => {
    const text = `# 作品

## 卷一

### 上部

内容。

**卷末史诗落点**

这是本卷的落点描述。
`;
    const result = parseOutline(text);
    expect(result.volumes[0].notes).toContain('这是本卷的落点描述。');
  });

  it('混沌双生伏笔自动归入当前卷的 foreshadows', () => {
    const text = `# 作品

## 卷一 起源

### 上部

内容。

**混沌双生·本卷反噬**

伏笔描述行1。
伏笔描述行2。
`;
    const result = parseOutline(text);
    expect(result.volumes[0].foreshadows).toHaveLength(1);
    expect(result.volumes[0].foreshadows[0].description).toContain('伏笔描述行1');
    expect(result.volumes[0].foreshadows[0].description).toContain('伏笔描述行2');
    // 全局 foreshadows 也包含
    expect(result.foreshadows).toHaveLength(1);
    // 标题由"混沌双生·<卷名后缀>反噬"生成
    expect(result.foreshadows[0].title).toContain('反噬');
  });

  it('设定分类（## 全书总纲）与设定项（### 核心立意）', () => {
    const text = `# 作品

## 全书总纲

### 核心立意

天下大势，合久必分，分久必合。

### 核心设定

双主角并行推进。
`;
    const result = parseOutline(text);
    expect(result.settings).toHaveLength(1);
    expect(result.settings[0].categoryName).toBe('全书总纲');
    expect(result.settings[0].items).toHaveLength(2);
    expect(result.settings[0].items[0].name).toBe('核心立意');
    expect(result.settings[0].items[0].content).toContain('天下大势');
    expect(result.settings[0].items[1].name).toBe('核心设定');
    expect(result.settings[0].items[1].content).toContain('双主角');
  });

  it('description 仅在遇到 # 标题后收集，排除文档开头修改说明', () => {
    const text = `1. **八卷结构**：本次重构说明

# 我的小说

## 卷一

### 上部

内容。
`;
    const result = parseOutline(text);
    // description 不应包含"本次重构说明"
    expect(result.description).not.toContain('本次重构说明');
    // 也不应包含"1. **八卷结构**：..."
    expect(result.description).not.toContain('八卷结构');
  });

  it('description 在 # 后、卷/设定/部 之前的文本被收集', () => {
    const text = `# 我的小说

这是一段作品描述。

## 卷一

### 上部

内容。
`;
    const result = parseOutline(text);
    expect(result.description).toContain('这是一段作品描述。');
  });

  it('description 累计达到 200 字符后停止追加新行', () => {
    // 每行 40 字符，加入第 5 行后 description.length = 5*40 + 4 空格 = 204，
    // 第 6 行 check 204 < 200 为 false，不再追加。
    const line = '描述内容'.repeat(10); // 40 字符
    const text = `# 作品

${line}

${line}

${line}

${line}

${line}

${line}

## 卷一

### 上部

内容。
`;
    const result = parseOutline(text);
    // 加入第 5 行后总长 204，第 6 行被跳过
    expect(result.description.length).toBe(204);
  });

  it('description 为空时用首个设定项内容替代', () => {
    const text = `# 作品

## 全书总纲

### 核心立意

天下大势，合久必分。
`;
    const result = parseOutline(text);
    // description 应来自首个 setting item 的 content
    expect(result.description).toContain('天下大势');
  });

  it('人物识别：KNOWN_FIGURES 高频出现者提取为 protagonist', () => {
    // 刘备 出现 3 次，关羽 出现 2 次，符合 >=2 阈值
    const text = `# 三国演义

## 卷一

### 上部

刘备率军出征。刘备麾下关羽为先锋。
刘备与关羽会师。
`;
    const result = parseOutline(text);
    expect(result.characters.length).toBeGreaterThan(0);
    // 最高频的应为 protagonist
    const protagonist = result.characters.find(c => c.role === 'protagonist');
    expect(protagonist).toBeDefined();
    expect(['刘备', '关羽']).toContain(protagonist!.name);
  });

  it('人物识别：低频角色（< maxCount * 15%）标记为 minor', () => {
    // 刘备 5 次，于禁 2 次（2 < 5*0.15=0.75 → 不满足，仍为 supporting）
    // 改为：刘备 20 次（足够多），于禁 2 次（2 < 20*0.15=3 → minor）
    const text = `# 作品

## 卷一

### 上部

${'刘备'.repeat(20)}
${'于禁'.repeat(2)}
`;
    const result = parseOutline(text);
    const yuJin = result.characters.find(c => c.name === '于禁');
    expect(yuJin).toBeDefined();
    expect(yuJin!.role).toBe('minor');
  });

  it('人物识别：元数据行中寿数格式提取人名', () => {
    const text = `# 作品

## 全书总纲

**寿数礼制**：庞统226年病逝、刘备227年驾崩、关羽228年辞世

## 卷一

### 上部

庞统献计。庞统殒命。
刘备出征。刘备凯旋。
关羽守荆州。关羽北上。
`;
    const result = parseOutline(text);
    const names = result.characters.map(c => c.name);
    expect(names).toContain('庞统');
    expect(names).toContain('刘备');
    expect(names).toContain('关羽');
  });

  it('totalWords = 各部字数之和', () => {
    const text = `# 作品

## 卷一

### 上部

内容一内容一。

### 下部

内容二内容二。

## 卷二

### 上部

内容三内容三。
`;
    const result = parseOutline(text);
    const sum = result.volumes.reduce(
      (s, v) => s + v.parts.reduce((s2, p) => s2 + p.wordCount, 0),
      0,
    );
    expect(result.totalWords).toBe(sum);
  });

  it('部内容中的 HTML 经 DOMPurify 清洗', () => {
    const text = `# 作品

## 卷一

### 上部

<script>alert(1)</script>

正常文本。
`;
    const result = parseOutline(text);
    expect(result.volumes[0].parts[0].content).not.toContain('<script>');
    expect(result.volumes[0].parts[0].content).toContain('正常文本');
  });

  it('空文本返回默认标题与空结构', () => {
    const result = parseOutline('');
    expect(result.title).toBe('导入大纲作品');
    expect(result.volumes).toHaveLength(0);
    expect(result.characters).toHaveLength(0);
    expect(result.settings).toHaveLength(0);
    expect(result.foreshadows).toHaveLength(0);
    expect(result.totalWords).toBe(0);
  });

  it('无 # 一级标题时 description 不被收集（避免误识文档开头说明）', () => {
    const text = `## 卷一

### 上部

内容。
`;
    const result = parseOutline(text);
    expect(result.description).toBe('');
  });
});
