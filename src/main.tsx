import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { useAppStore } from './store/useAppStore'
import { runMigration } from './utils/storage'
import { toast } from './hooks/useToast'

void useAppStore.getState().loadAISettings();
void useAppStore.getState().loadAppPreferences();
void useAppStore.getState().checkForRecovery();
// 启动时跑一次数据迁移（目前仅记录版本号，预留扩展点）
void runMigration().catch(e => console.warn('Migration failed:', e));

// 渲染层日志转发：把 catch 块 / window.onerror / unhandledrejection 通过 IPC 上报到
// 主进程 logger，与主进程日志统一落盘到 userData/logs/main.log。
// 生产环境用户无 devtools，渲染层错误仅出现在 console 用户无法提供；转发后用户报障
// 只需提供 main.log 即可定位渲染层异常。
// 失败时静默：日志转发本身不应成为新的错误源（如主进程未启动时 IPC 会 reject）
const forwardLog = (level: 'error' | 'warn', message: string, fields?: Record<string, unknown>): void => {
  try {
    window.electronAPI?.logger?.write(level, message, fields)?.catch(() => { /* 静默 */ });
  } catch {
    /* 静默 */
  }
};

// 全局兜底：项目中存在大量 `void` 丢弃的 Promise（如 storage.set / IPC 调用），
// rejection 默认只在控制台以 Unhandled promise rejection 警告出现，用户无感知。
// 此处统一捕获并 toast 提示，让静默失败可见化（开发期排错、用户期感知数据写入失败）
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
  // 转发到主进程日志：含 stack 便于定位
  forwardLog('error', `unhandledrejection: ${msg}`, {
    stack: e.reason instanceof Error ? e.reason.stack || '' : '',
    reason: e.reason instanceof Error ? e.reason.name : typeof e.reason,
  });
  // 仅对非"用户主动 abort"的异常弹 toast（AbortError 通常是主动取消，无需打扰）
  if (e.reason instanceof Error && e.reason.name === 'AbortError') return;
  toast.error('操作异常', msg || '发生了未捕获的异常，请重试或查看控制台');
});

window.addEventListener('error', (e) => {
  // 资源加载错误（Event 而非 ErrorEvent）跳过，由浏览器自身处理
  if (!(e instanceof ErrorEvent)) return;
  console.error('[window.error]', e.error || e.message);
  // 转发到主进程日志：含 filename / lineno 便于定位
  forwardLog('error', `window.error: ${e.message}`, {
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    stack: e.error instanceof Error ? e.error.stack || '' : '',
  });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
