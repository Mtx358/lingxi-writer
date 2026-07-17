import type { Project, Chapter, Character, SettingCategory, SettingItem, Foreshadow, Material, ProjectConfig } from '@/types';
import { generateId } from '@/utils/storage';

const defaultConfig: ProjectConfig = {
  theme: 'dark',
  fontSize: 18,
  lineHeight: 1.8,
  fontFamily: 'serif',
  showLineNumbers: true,
  showWordCount: true,
  zenMode: false,
  aiSettings: {
    provider: 'mock',
    style: 'balanced',
    descriptionDensity: 50,
    dialogueDensity: 50,
    strictness: 50,
    temperature: 0.7,
    maxTokens: 2000,
    autoCheckConflicts: true,
  },
};

export function createDefaultProject(title: string, template: Project['template'] = 'blank'): Project {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    title,
    description: '',
    template,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    totalWords: 0,
    config: { ...defaultConfig },
  };
}

export function createSampleProject(): {
  project: Project;
  chapters: Chapter[];
  characters: Character[];
  settingCategories: SettingCategory[];
  settingItems: SettingItem[];
  foreshadows: Foreshadow[];
  materials: Material[];
} {
  const projectId = generateId();
  const now = new Date().toISOString();

  const project: Project = {
    id: projectId,
    title: '星尘往事',
    description: '一个关于记忆、时间与救赎的科幻故事。在未来世界，人们可以提取和交易记忆，但代价是什么？',
    template: 'three-act',
    cover: '',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    totalWords: 3240,
    config: { ...defaultConfig },
  };

  const chapter1Id = generateId();
  const chapter2Id = generateId();
  const chapter3Id = generateId();
  const chapter4Id = generateId();
  const act1Id = generateId();
  const act2Id = generateId();
  const act3Id = generateId();
  // 角色 ID 提前定义，供章节 characterFocus 引用（统一存角色 ID 而非名字）
  const char1Id = generateId();
  const char2Id = generateId();
  const char3Id = generateId();

  const chapters: Chapter[] = [
    {
      id: act1Id,
      projectId,
      parentId: null,
      title: '第一幕：觉醒',
      summary: '主角发现记忆的真相',
      order: 0,
      level: 1,
      levelType: 'book',
      status: 'done',
      wordCount: 1560,
      content: '',
      createdAt: now,
      updatedAt: now,
      theme: '记忆与身份',
      coreProposition: '失去记忆的人还是原来的自己吗？',
    },
    {
      id: chapter1Id,
      projectId,
      parentId: act1Id,
      title: '第一章：雨中的陌生人',
      summary: '林远在雨天遇到一个神秘女子，她似乎认识他，但他毫无印象。',
      order: 0,
      level: 2,
      levelType: 'chapter',
      status: 'done',
      wordCount: 890,
      content: `<h2>第一章：雨中的陌生人</h2>
<p>雨已经下了三天。</p>
<p>林远站在记忆银行的落地窗前，看着灰蒙蒙的城市。霓虹在雨幕中晕染成一片片模糊的色块，像被遗忘的梦境。</p>
<p>"林先生，您确定要提取这段记忆吗？"身后的咨询师轻声问道。</p>
<p>他转过身，露出一个疲惫的微笑："确定。那段记忆...太痛苦了。"</p>
<p>咨询师点点头，在平板上操作了几下。玻璃舱门缓缓打开，发出轻微的嘶嘶声。林远走进去，躺在冰凉的金属床上。</p>
<p>"放松，深呼吸，整个过程只需要十分钟。"</p>
<p>他闭上眼，脑海中浮现出那张脸——苏晚。他曾经爱过的女人，也是他选择遗忘的人。</p>
<p>机器启动了，细微的电流感从太阳穴蔓延开来。</p>
<p>然后，他看见了雨。</p>
<p>不是此刻窗外的雨，是三年前的那场雨。他站在十字路口，对面站着一个撑着黑伞的女人。雨水顺着伞沿滴落，模糊了她的脸。</p>
<p>她向他走来。</p>
<p>越来越近。</p>
<p>就在他快要看清她面容的那一刻，画面戛然而止。</p>
<p>林远猛地睁开眼，大口喘着气。玻璃舱门已经打开，咨询师站在外面，表情有些奇怪。</p>
<p>"林先生，出了点问题..."</p>
<p>"什么问题？"</p>
<p>"您的记忆里...有一段被加密了。不是您自己设置的加密。"</p>
<p>林远愣住了："什么意思？"</p>
<p>"意思是，有人在您的记忆里藏了东西。"咨询师的声音压得很低，"而且...加密等级非常高。"</p>
<p>雨还在下。</p>
<p>林远走出记忆银行的时候，雨丝打在脸上，冰凉刺骨。他抬头看向灰蒙蒙的天空，第一次对自己的记忆产生了怀疑。</p>
<p>他到底遗忘了什么？</p>
<p>又或者，他从未真正记得过？</p>`,
      createdAt: now,
      updatedAt: now,
      characterFocus: [char1Id, char2Id],
      keyEvents: ['林远提取记忆失败', '发现记忆被加密'],
    },
    {
      id: chapter2Id,
      projectId,
      parentId: act1Id,
      title: '第二章：加密的记忆',
      summary: '林远开始调查自己被加密的记忆，发现更多谜团。',
      order: 1,
      level: 2,
      levelType: 'chapter',
      status: 'reviewing',
      wordCount: 670,
      content: `<h2>第二章：加密的记忆</h2>
<p>"你说我的记忆被人动过手脚？"</p>
<p>老陈叼着烟，靠在椅背上，眯着眼打量林远。这家名叫"回收站"的酒吧藏在城市的底层，空气里混合着酒精和机油的味道。</p>
<p>"不止是动过。"林远把记忆芯片推到桌上，"是被加密了。用的军方级别的算法。"</p>
<p>老陈拿起芯片，在手里掂了掂："你知道这意味着什么吗？"</p>
<p>"我要你帮我解开。"</p>
<p>"兄弟，这可是掉脑袋的事儿。"老陈摇摇头，但眼睛里闪着光，"不过...我喜欢挑战。"</p>
<p>他把芯片插入面前那台拼凑起来的机器，屏幕上开始滚动密密麻麻的代码。林远看着那些飞速闪过的字符，心跳越来越快。</p>
<p>苏晚是谁？</p>
<p>他为什么会忘记她？</p>
<p>而那个加密的记忆里，又藏着什么秘密？</p>
<p>老陈突然吹了声口哨："有意思。"</p>
<p>"怎么了？"</p>
<p>"这加密...有两层。"老陈指着屏幕，"外面一层是标准的军方加密，但里面这层...是手写的。"</p>
<p>"手写？"</p>
<p>"对，像是某个人独创的加密方式。"老陈抬头看他，眼神里带着一丝玩味，"而且，我好像见过这种手法。"</p>
<p>林远的呼吸停了一拍："谁？"</p>
<p>"一个传说中的人物。没人见过她的真面目，只知道代号——'幽灵'。"老陈吐出一口烟，"据说她十年前从记忆管理局叛逃，带走了很多秘密。"</p>
<p>他顿了顿，看着林远的眼睛：</p>
<p>"林远，你到底惹上了什么人？"</p>`,
      createdAt: now,
      updatedAt: now,
      characterFocus: [char1Id, char3Id],
      keyEvents: ['老陈发现双层加密', '揭示幽灵的存在'],
    },
    {
      id: act2Id,
      projectId,
      parentId: null,
      title: '第二幕：追索',
      summary: '追寻真相的旅程',
      order: 1,
      level: 1,
      levelType: 'book',
      status: 'writing',
      wordCount: 1280,
      content: '',
      createdAt: now,
      updatedAt: now,
      theme: '追寻与抉择',
      coreProposition: '为了真相，愿意付出什么代价？',
    },
    {
      id: chapter3Id,
      projectId,
      parentId: act2Id,
      title: '第三章：幽灵的踪迹',
      summary: '林远开始追踪"幽灵"的下落，却发现自己卷入了更大的阴谋。',
      order: 0,
      level: 2,
      levelType: 'chapter',
      status: 'writing',
      wordCount: 1280,
      content: `<h2>第三章：幽灵的踪迹</h2>
<p>城市的底层永远是黑暗的。</p>
<p>林远沿着锈迹斑斑的楼梯往下走，每一步都扬起细小的灰尘。老陈给他的地址在地下七层，那里是记忆黑市的腹地。</p>
<p>"你要找幽灵？"</p>
<p>坐在柜台后面的女人抬起头，脸上有一道从眼角延伸到下巴的伤疤。她打量着林远，眼神像刀子一样。</p>
<p>"你认识她？"</p>
<p>"认识？"女人笑了，笑声沙哑难听，"这里的每个人都想认识她。但没人见过她。"</p>
<p>"我必须找到她。"</p>
<p>"每个人都这么说。"女人拿出一个金属盒子，放在柜台上，"但找她是有代价的。"</p>
<p>"什么代价？"</p>
<p>"一段记忆。"女人的手指轻轻敲着盒子，"你最珍贵的那段。"</p>
<p>林远沉默了。</p>
<p>他最珍贵的记忆是什么？他甚至不知道自己丢失了多少记忆。</p>
<p>"怎么样？"女人歪着头，"想好了吗？"</p>
<p>林远深吸一口气："好。"</p>
<p>女人笑了，这次笑容里有了点温度："有意思。你是第一个毫不犹豫的。"</p>
<p>她把盒子推过来："把手放上去。"</p>
<p>林远照做了。一阵轻微的刺痛之后，他感觉有什么东西被抽离了。</p>
<p>是那个下雨天。</p>
<p>不，是更早以前。阳光明媚的午后，草地上有个女孩在笑，风吹起她的头发，她转身看向他——</p>
<p>画面消失了。</p>
<p>"好了。"女人把盒子收回去，"作为交易的一部分，我给你一个建议。"</p>
<p>"什么建议？"</p>
<p>"别找幽灵。"女人的表情变得严肃，"因为找到她的人，没有一个有好下场。"</p>
<p>林远转身离开。</p>
<p>但他已经没有退路了。</p>
<p>当他走出黑市的时候，一个人影靠在墙边，挡住了他的去路。</p>
<p>是个女人。穿着黑色风衣，兜帽拉得很低，看不清脸。</p>
<p>"林远。"她开口了，声音很轻，却像惊雷一样在他耳边炸开。</p>
<p>这个声音...</p>
<p>他在哪里听过？</p>
<p>"你在找我？"女人抬起头，露出一张苍白而美丽的脸。</p>
<p>她的眼睛是深灰色的，像暴雨前的天空。</p>
<p>"我是苏晚。"她说，"也是你要找的——幽灵。"</p>`,
      createdAt: now,
      updatedAt: now,
      characterFocus: [char1Id, char2Id],
      keyEvents: ['林远进入记忆黑市', '用珍贵记忆交换情报', '苏晚正式出场'],
    },
    {
      id: act3Id,
      projectId,
      parentId: null,
      title: '第三幕：真相',
      summary: '最终的真相与选择',
      order: 2,
      level: 1,
      levelType: 'book',
      status: 'draft',
      wordCount: 0,
      content: '',
      createdAt: now,
      updatedAt: now,
      theme: '真相与救赎',
      coreProposition: '知道真相后，能否原谅过去？',
    },
    {
      id: chapter4Id,
      projectId,
      parentId: act3Id,
      title: '第四章：记忆的代价',
      summary: '',
      order: 0,
      level: 2,
      levelType: 'chapter',
      status: 'draft',
      wordCount: 0,
      content: '',
      createdAt: now,
      updatedAt: now,
    },
  ];

  const characters: Character[] = [
    {
      id: char1Id,
      projectId,
      name: '林远',
      role: 'protagonist',
      color: '#d4a574',
      profile: {
        age: '28岁',
        gender: '男',
        appearance: '中等身材，总是穿着深色外套，眼下有淡淡的黑眼圈，眼神里带着一丝与年龄不符的疲惫。',
        personality: '沉默寡言，观察力敏锐，内心善良但习惯用冷漠伪装。一旦认定的事情会坚持到底。',
        background: '前记忆管理局技术员，因为某件事辞职，现在做着普通的记忆整理工作。',
        motivation: '找回失去的记忆，弄清自己的过去。',
        goal: '查明苏晚的身份和自己被加密记忆的真相。',
        weakness: '害怕面对痛苦的过去，容易陷入自我怀疑。',
        fear: '发现自己一直活在谎言中。',
        arc: '从逃避过去到勇敢面对，最终学会与不完美的记忆共处。',
        occupation: '记忆整理师',
      },
      relationships: [
        { targetId: char2Id, type: '旧识/恋人？', description: '与苏晚似乎有很深的过去，但林远完全不记得了。', intensity: 90 },
        { targetId: char3Id, type: '朋友', description: '老陈是林远为数不多的朋友，两人认识多年。', intensity: 70 },
      ],
      appearanceCount: 3,
      dialogueCount: 15,
      tags: ['主角', '记忆管理局前员工'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: char2Id,
      projectId,
      name: '苏晚 / 幽灵',
      role: 'protagonist',
      color: '#7c9eb2',
      profile: {
        age: '26岁',
        gender: '女',
        appearance: '苍白美丽，深灰色的眼睛，总是穿着黑色风衣，整个人像影子一样安静。',
        personality: '神秘莫测，智商极高，行事果断，内心深处藏着温柔和悲伤。',
        background: '前记忆管理局顶级工程师，十年前叛逃，成为地下世界传说中的"幽灵"。',
        motivation: '保护某个重要的秘密，同时保护林远。',
        goal: '阻止记忆管理局的阴谋，让真相大白。',
        weakness: '对林远的感情是她最大的软肋。',
        fear: '林远记起一切后会恨她。',
        arc: '从独自承担一切到学会信任，与林远并肩作战。',
        occupation: '前记忆工程师/黑客',
      },
      relationships: [
        { targetId: char1Id, type: '恋人/守护者', description: '深爱着林远，为了保护他选择让他遗忘。', intensity: 95 },
      ],
      appearanceCount: 1,
      dialogueCount: 4,
      tags: ['女主角', '神秘', '黑客'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: char3Id,
      projectId,
      name: '老陈',
      role: 'supporting',
      color: '#8b7355',
      profile: {
        age: '50多岁',
        gender: '男',
        appearance: '头发花白，总是叼着烟，手背上有旧伤疤，看起来不修边幅但眼神精明。',
        personality: '表面市侩，实则重情重义，消息灵通，人脉广泛。',
        background: '前记忆管理局基层员工，因犯错被开除，现在经营地下酒吧兼做信息贩子。',
        motivation: '赚钱，同时照顾老朋友林远。',
        goal: '在乱世中活下去，保护在意的人。',
        weakness: '贪杯，嘴上不饶人。',
        fear: '失去为数不多的朋友。',
        arc: '从明哲保身到挺身而出，帮助林远和苏晚。',
        occupation: '酒吧老板/信息贩子',
      },
      relationships: [
        { targetId: char1Id, type: '忘年交', description: '看着林远长大，把他当侄子一样看待。', intensity: 80 },
      ],
      appearanceCount: 1,
      dialogueCount: 6,
      tags: ['配角', '情报贩子'],
      createdAt: now,
      updatedAt: now,
    },
  ];

  const settingCategories: SettingCategory[] = [
    { id: generateId(), projectId, name: '世界观', icon: 'globe', color: '#6b7c93', order: 0, parentId: null },
    { id: generateId(), projectId, name: '势力组织', icon: 'building', color: '#d4a574', order: 1, parentId: null },
    { id: generateId(), projectId, name: '地点', icon: 'map-pin', color: '#7c9eb2', order: 2, parentId: null },
    { id: generateId(), projectId, name: '科技体系', icon: 'cpu', color: '#9b7cc9', order: 3, parentId: null },
  ];

  const settingItems: SettingItem[] = [
    {
      id: generateId(),
      projectId,
      categoryId: settingCategories[3].id,
      name: '记忆提取技术',
      description: '可以提取、存储、交易人类记忆的技术',
      content: '记忆提取技术是这个时代最伟大也最危险的发明。人们可以将美好的记忆永久保存，也可以将痛苦的记忆剥离出售。但记忆的买卖也带来了无数社会问题——记忆盗窃、记忆篡改、记忆成瘾...\n\n技术原理：通过神经接口扫描大脑海马体，将记忆转化为数字信号存储在记忆芯片中。提取过程本身是无痛的，但被提取的记忆会从大脑中消失。',
      references: [],
      tags: ['核心设定', '科技'],
      order: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      projectId,
      categoryId: settingCategories[1].id,
      name: '记忆管理局',
      description: '管理记忆提取与交易的官方机构',
      content: '记忆管理局是这个世界最有权势的机构之一，掌控着所有合法的记忆交易。他们声称自己的使命是"保护人类的记忆遗产"，但暗地里进行着各种不为人知的实验。\n\n等级制度：局长 → 副局长 → 部门主管 → 技术员 → 基层员工\n\n已知部门：记忆存储部、记忆审核部、记忆科技部、执行部',
      references: [],
      tags: ['组织', '反派'],
      order: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      projectId,
      categoryId: settingCategories[2].id,
      name: '新海市',
      description: '故事发生的主要城市',
      content: '一座靠海的超级大都市，贫富差距悬殊。上层区光鲜亮丽，底层区混乱不堪。记忆黑市就藏在城市的最底层。\n\n重要地点：\n- 记忆银行：位于上层区，合法的记忆存储交易场所\n- 回收站酒吧：老陈的店，位于底层区\n- 记忆黑市：地下七层，非法记忆交易集散地\n- 记忆管理局总部：城市中心最高的建筑',
      references: [],
      tags: ['城市', '主舞台'],
      order: 0,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const foreshadows: Foreshadow[] = [
    {
      id: generateId(),
      projectId,
      title: '雨中的身影',
      description: '第一章开头，林远在记忆闪回中看到的雨中身影，在第三章末尾与苏晚的出场形成呼应。',
      status: 'paid-off',
      plantedChapterId: chapter1Id,
      payoffChapterId: chapter3Id,
      priority: 'high',
      relatedCharacters: [char1Id, char2Id],
      relatedSettings: [],
      chaptersSinceMention: 0,
      notes: '第一个伏笔，建立悬念。',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      projectId,
      title: '被加密的记忆',
      description: '林远的记忆里有一段被军方级别加密的内容，是谁加密的？里面藏着什么？',
      status: 'progressing',
      plantedChapterId: chapter1Id,
      payoffChapterId: null,
      priority: 'high',
      relatedCharacters: [char1Id, char2Id],
      relatedSettings: [settingItems[1].id],
      chaptersSinceMention: 2,
      notes: '核心悬念，贯穿全书。',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      projectId,
      title: '老陈的过去',
      description: '老陈为什么被记忆管理局开除？他和林远的关系仅仅是朋友吗？',
      status: 'planted',
      plantedChapterId: chapter2Id,
      payoffChapterId: null,
      priority: 'medium',
      relatedCharacters: [char3Id, char1Id],
      relatedSettings: [settingItems[1].id],
      chaptersSinceMention: 1,
      notes: '可以在后期揭示老陈的真实身份。',
      createdAt: now,
      updatedAt: now,
    },
  ];

  const materials: Material[] = [
    {
      id: generateId(),
      projectId,
      title: '关于记忆的哲学思考',
      type: 'inspiration',
      content: '如果失去了记忆，我们还是我们自己吗？\n\n记忆是身份的基石。没有记忆，人就像没有根的浮萍。但反过来说，如果记忆可以被篡改、被植入，那"我是谁"这个问题还有意义吗？\n\n可以在故事中探讨：重要的不是发生了什么，而是我们选择记住什么。',
      tags: ['灵感', '主题'],
      category: '核心灵感',
      references: [],
      pinned: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      projectId,
      title: '《银翼杀手》赛博朋克美学参考',
      type: 'reference',
      content: '视觉风格参考：\n- 永不停歇的雨\n- 霓虹灯光在湿漉漉的街道上反射\n- 巨大的电子广告牌\n- 高层建筑与底层贫民窟的对比\n\n氛围：忧郁、疏离、迷茫，但又有某种诗意。',
      source: '电影《银翼杀手》',
      tags: ['参考', '氛围', '赛博朋克'],
      category: '视觉参考',
      references: [chapter1Id],
      pinned: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      projectId,
      title: '记忆提取技术可能的社会影响',
      type: 'research',
      content: '研究笔记：\n\n1. 经济方面：\n- 记忆成为新的商品和货币\n- 出现记忆交易所、记忆银行等机构\n- 记忆盗窃成为新的犯罪形式\n\n2. 社会方面：\n- 贫富差距扩大——富人可以购买他人的美好记忆\n- "记忆成瘾"成为新的心理疾病\n- 人们开始逃避现实，沉迷于购买的记忆中\n\n3. 伦理方面：\n- 记忆的所有权归谁？\n- 法庭上记忆能否作为证据？\n- 用记忆篡改技术"改正"罪犯是否道德？',
      tags: ['研究', '世界观', '社会'],
      category: '深度研究',
      references: [settingItems[0].id, settingItems[1].id],
      pinned: false,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return { project, chapters, characters, settingCategories, settingItems, foreshadows, materials };
}

export const PROJECT_TEMPLATES: { id: Project['template']; name: string; description: string; icon: string }[] = [
  { id: 'blank', name: '空白项目', description: '从零开始，完全自由的创作空间', icon: 'file-text' },
  { id: 'three-act', name: '三幕式结构', description: '经典的三幕剧结构：建置-对抗-结局', icon: 'layers' },
  { id: 'hero-journey', name: '英雄之旅', description: '十二阶段英雄旅程模板，适合奇幻冒险', icon: 'map' },
  { id: 'chapter', name: '章回体', description: '传统章回小说结构，适合长篇连载', icon: 'book-open' },
];
