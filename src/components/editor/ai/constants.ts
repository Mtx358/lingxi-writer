/**
 * AIPanel 相关常量的集中 re-export。
 *
 * 这些常量本身定义在 @/constants/config（全局共享），此处 re-export 让 ai/ 目录下
 * 各子模块统一从 ./constants 引入，便于后续调整上下文窗口/节流参数时单点修改。
 */
export {
  AI_CONTEXT_AIPANEL_CONTINUATION_CHARS,
  AI_CONTEXT_EXPAND_CHARS,
  AI_CONTEXT_POLISH_CHARS,
  AI_CONTEXT_PERSPECTIVE_CHARS,
  AI_STREAM_THROTTLE_MS,
} from '@/constants/config';
