/**
 * 大纲打磨面板：内部类型
 *
 * 按规格书 5 阶段组织：灵感打磨 / 骨架打磨 / 章节打磨 / 深度校验 / 颠覆性修改
 * 每个阶段包含若干子功能 Tab，顶层用 StageId 切换阶段，阶段内用 TabId 切换子功能。
 */

// 5 大阶段标识（对应规格书五阶段）
export type StageId = 'inspiration' | 'skeleton' | 'chapter' | 'verify' | 'modify';

// 子功能 Tab 标识
export type TabId =
  // 灵感打磨阶段
  | 'inspiration'      // 碎片捕获 + 卡片促活 + 连线沙盘
  | 'inspirationCanvas' // 力导向连线画布（节点拖拽 + 框选生成大纲 + 灵感缺口）
  | 'nlCommand'        // 自然语言命令（说什么就跳到哪）
  // 骨架打磨阶段
  | 'skeleton'         // 骨架（核心驱动 + 冲突罗盘 + 结构变体）
  | 'coreDriver'       // 核心驱动锁定（独立面板）
  // 章节打磨阶段
  | 'chapterGrid'      // 章节卡片网格（全章鸟瞰）
  | 'beats'            // 章节节拍编辑器
  | 'expansion'        // 情节扩展器
  | 'multiline'        // 多线作战指挥台
  | 'sceneLocator'     // 场景定位仪（四要素标记）
  | 'timeline'         // 章节时间轴（故事节拍横向鸟瞰）
  | 'skeletonTimeline' // 骨架时间轴（高潮位 + 节奏预设 + 断层检测）
  // 深度校验阶段
  | 'diagnosis'        // 智能诊断（六维度问题清单）
  | 'pacing'           // 节奏压力测试
  | 'characters'       // 人物弧光校验
  | 'readerEmpathy'    // 读者共情校验
  | 'foreshadowBoard'  // 草蛇灰线看板
  | 'emotionConsistency' // 情感一致性曲线
  | 'curveDrag'        // 曲线拖拽（设计张力/情感目标曲线）
  | 'forceCanvas'      // 力导向画布（角色/章节/伏笔关系网）
  | 'comments'         // 章节批注
  | 'reviewReflow'     // 读者评论回流（AI 归类汇入各阶段）
  // 颠覆性修改阶段
  | 'causal'           // 因果推演预览
  | 'sandbox'          // 沙盒试运行前后对比（验证闭环）
  | 'snapshots'        // 版本花园（快照管理）
  | 'branchGarden'     // 分支花园（从快照分叉并行探索 + 合并）
  | 'versionDiff';     // 版本对比双栏

// 阶段定义（用于顶层导航渲染）
export interface StageDef {
  id: StageId;
  label: string;
  description: string;
  tabs: TabId[];
}

// 阶段映射表
export const STAGES: StageDef[] = [
  {
    id: 'inspiration',
    label: '灵感打磨',
    description: '从混沌碎片到萌芽故事核',
    tabs: ['inspiration', 'inspirationCanvas', 'nlCommand'],
  },
  {
    id: 'skeleton',
    label: '骨架打磨',
    description: '把故事核磨成稳固的全书龙骨',
    tabs: ['coreDriver', 'skeleton'],
  },
  {
    id: 'chapter',
    label: '章节打磨',
    description: '把粗框架磨成可落地的写作节拍',
    tabs: ['chapterGrid', 'beats', 'expansion', 'multiline', 'sceneLocator', 'timeline', 'skeletonTimeline'],
  },
  {
    id: 'verify',
    label: '深度校验',
    description: '把初稿大纲磨得无懈可击',
    tabs: ['diagnosis', 'pacing', 'characters', 'readerEmpathy', 'foreshadowBoard', 'emotionConsistency', 'curveDrag', 'forceCanvas', 'comments', 'reviewReflow'],
  },
  {
    id: 'modify',
    label: '颠覆性修改',
    description: '安全拆墙，不崩全局',
    tabs: ['causal', 'sandbox', 'versionDiff', 'snapshots', 'branchGarden'],
  },
];

