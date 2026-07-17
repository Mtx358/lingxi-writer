/**
 * 全局常量配置：统一管理散落的魔法数字，修改时只需在此处调整
 */

/** 自动保存间隔（毫秒） */
export const AUTOSAVE_INTERVAL = 30000;

/** 搜索输入防抖延迟（毫秒） */
export const SEARCH_DEBOUNCE_DELAY = 250;

/** 编辑器章节切换防抖延迟（毫秒），用于 isSwitchingRef 复位 */
export const EDITOR_SWITCH_DELAY = 100;

/** 单章撤销/重做历史栈最大长度 */
export const HISTORY_MAX_LENGTH = 50;

/** 行级 Diff 字符上限，超过则截断以防止主线程阻塞 */
export const DIFF_CHAR_LIMIT = 1000;

/** AI 流式请求 IPC 超时（毫秒），5 分钟 */
export const AI_STREAM_TIMEOUT = 300000;

/** IPC 默认超时（毫秒） */
export const IPC_DEFAULT_TIMEOUT = 30000;

/** 预览文本截取长度（搜索结果、连接测试等） */
export const PREVIEW_TEXT_LENGTH = 50;

/** 自动备份间隔（毫秒），5 分钟 */
export const AUTO_BACKUP_INTERVAL = 5 * 60 * 1000;

/** 文件备份保留数量 */
export const BACKUP_KEEP_COUNT = 5;

/** 章节最大嵌套层级：levelType 仅 5 种（book/volume/part/section/chapter），超过后类型重复 */
export const CHAPTER_MAX_LEVEL = 5;

/** AI 流式输出渲染节流间隔（毫秒）：避免逐 chunk 插入导致编辑器频繁重渲染 */
export const AI_STREAM_THROTTLE_MS = 120;

/** characterFocus 引用类型：'id' = 角色 ID（默认）；'name' = 角色名（旧数据兼容） */
export const CHARACTER_FOCUS_TYPE = 'id' as const;

/** 编辑器内容防抖写入 store 的间隔（毫秒），避免每次按键触发状态更新和磁盘 IO */
export const EDITOR_CONTENT_UPDATE_DEBOUNCE = 500;

/** 编辑器外部内容替换后 isSwitchingRef 复位延迟（毫秒） */
export const EDITOR_EXTERNAL_SYNC_DELAY = 100;

/** AI 续写上下文长度（字符数）：TiptapEditor 内联续写取末尾 N 字符 */
export const AI_CONTEXT_CONTINUATION_CHARS = 2000;

/** AI 面板续写上下文长度（字符数）：AIPanel 取末尾 N 字符 */
export const AI_CONTEXT_AIPANEL_CONTINUATION_CHARS = 500;

/** AI 扩写上下文长度（字符数） */
export const AI_CONTEXT_EXPAND_CHARS = 200;

/** AI 润色上下文长度（字符数） */
export const AI_CONTEXT_POLISH_CHARS = 300;

/** AI 换视角上下文长度（字符数） */
export const AI_CONTEXT_PERSPECTIVE_CHARS = 300;

/** ImageFallback LRU 缓存上限（条目数）：超过后淘汰最久未访问的 dataURL */
export const IMAGE_CACHE_MAX_ENTRIES = 64;
