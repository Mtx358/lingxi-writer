import { useState, useCallback, useEffect, memo, useId } from 'react';
import { RefreshCw, Wifi } from 'lucide-react';
import { aiService } from '@/utils/aiService';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import type { AISettings } from '@/types';

/**
 * AIPanel 顶部"齿轮 → 设置面板"区块。
 *
 * 包含：provider 切换 / baseUrl/model/apiKey 防抖输入 / 测试连接 / 描写浓度/对话浓度/
 * 严守设定/最大生成长度/创造性/风格偏好等风格参数。
 *
 * 拆分自原 AIPanel.tsx 的 showSettings 区块，状态本地化（testing/testResult），
 * 文本类设置通过 debouncedUpdateAISettings 写入 store。
 */
export interface GenerateModeSelectorProps {
  showSettings: boolean;
  aiSettings: AISettings;
  updateAISettings: (updates: Partial<AISettings>) => void;
  /** 文本类设置（baseUrl/model/apiKey）的防抖写入 */
  debouncedUpdateAISettings: (updates: Partial<AISettings>) => void;
  /** 切换 provider：填充对应默认 baseUrl/model */
  onProviderChange: (provider: AISettings['provider']) => void;
  /** 同步 store 中的 aiSettings 到 aiService（测试连接前调用） */
  syncSettings: () => void;
}

// memo：父组件 AIPanel 在 instructionText 按键、showExpandMenu 切换等无关状态变化时
// 频繁重渲染；本组件 props 均为稳定引用（aiSettings 来自 store selector，回调均
// useCallback），memo 可跳过这些无关重渲染。设置面板展开时输入仍实时更新（props 变化触发重渲染）。
const GenerateModeSelector = memo(function GenerateModeSelector({
  showSettings,
  aiSettings,
  updateAISettings,
  debouncedUpdateAISettings,
  onProviderChange,
  syncSettings,
}: GenerateModeSelectorProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const uid = useId();

  // 切换 provider 时清空上一次的测试结果，避免显示旧 provider 的连接状态
  useEffect(() => {
    setTestResult(null);
  }, [aiSettings.provider]);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    syncSettings();
    try {
      const result = await aiService.testConnection();
      setTestResult(result);
    } catch (e) {
      // testConnection 抛错（网络异常/超时等）时也需给出反馈，否则按钮卡在"测试中..."且无错误提示
      const msg = getErrorMessage(e);
      console.error('AI testConnection error:', e);
      setTestResult({ success: false, message: msg });
      toast.error('连接测试失败', msg);
    } finally {
      setTesting(false);
    }
  }, [syncSettings]);

  if (!showSettings) return null;

  return (
    <div className="p-3 border-b border-ink-800/50 space-y-4 bg-ink-800/30 animate-slide-down">
      {/* AI 模型配置区 */}
      <div className="space-y-3 pb-3 border-b border-ink-700/50">
        <div>
          <div id={`${uid}-provider-group`} className="text-xs text-ink-400 block mb-1.5">AI 提供商</div>
          <div className="grid grid-cols-3 gap-1" role="group" aria-labelledby={`${uid}-provider-group`}>
            {([
              { id: 'mock', label: 'Mock' },
              { id: 'local', label: 'Ollama' },
              { id: 'openai', label: 'OpenAI' },
              { id: 'deepseek', label: 'DeepSeek' },
            ] as const).map(p => (
              <button
                key={p.id}
                onClick={() => onProviderChange(p.id)}
                className={`py-1 text-xs rounded transition-colors ${
                  aiSettings.provider === p.id
                    ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                    : 'bg-ink-700/50 text-ink-400 border border-transparent hover:text-ink-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {aiSettings.provider !== 'mock' && (
          <>
            <div>
              <label htmlFor={`${uid}-base-url`} className="text-xs text-ink-400 block mb-1">服务地址</label>
              <input
                id={`${uid}-base-url`}
                type="text"
                value={aiSettings.baseUrl || ''}
                onChange={(e) => debouncedUpdateAISettings({ baseUrl: e.target.value })}
                placeholder={
                  aiSettings.provider === 'local' ? 'http://localhost:11434' :
                  aiSettings.provider === 'deepseek' ? 'https://api.deepseek.com' :
                  'https://api.openai.com'
                }
                className="w-full px-2 py-1 text-xs bg-ink-700/50 text-ink-200 border border-ink-600/50 rounded focus:outline-none focus:border-amber-400/50"
              />
            </div>

            <div>
              <label htmlFor={`${uid}-model`} className="text-xs text-ink-400 block mb-1">模型名称</label>
              <input
                id={`${uid}-model`}
                type="text"
                value={aiSettings.model || ''}
                onChange={(e) => debouncedUpdateAISettings({ model: e.target.value })}
                placeholder={
                  aiSettings.provider === 'local' ? 'qwen2.5:7b' :
                  aiSettings.provider === 'deepseek' ? 'deepseek-chat' :
                  'gpt-4o-mini'
                }
                className="w-full px-2 py-1 text-xs bg-ink-700/50 text-ink-200 border border-ink-600/50 rounded focus:outline-none focus:border-amber-400/50"
              />
            </div>

            {(aiSettings.provider === 'openai' || aiSettings.provider === 'deepseek') && (
              <div>
                <label htmlFor={`${uid}-api-key`} className="text-xs text-ink-400 block mb-1">API Key</label>
                <input
                  id={`${uid}-api-key`}
                  type="password"
                  autoComplete="off"
                  value={aiSettings.apiKey || ''}
                  onChange={(e) => debouncedUpdateAISettings({ apiKey: e.target.value })}
                  placeholder={aiSettings.provider === 'deepseek' ? 'sk-...' : 'sk-...'}
                  className="w-full px-2 py-1 text-xs bg-ink-700/50 text-ink-200 border border-ink-600/50 rounded focus:outline-none focus:border-amber-400/50"
                />
              </div>
            )}

            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="w-full py-1.5 text-xs bg-ink-700/50 text-ink-300 hover:bg-ink-700 rounded transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
            >
              {testing ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  测试中...
                </>
              ) : (
                <>
                  <Wifi className="w-3 h-3" />
                  测试连接
                </>
              )}
            </button>

            {testResult && (
              <div className={`text-xs p-2 rounded break-all ${testResult.success ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                {testResult.message}
              </div>
            )}
          </>
        )}
      </div>

      {/* 写作风格参数 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={`${uid}-description-density`} className="text-xs text-ink-400">描写浓度</label>
          <span className="text-xs text-amber-400">{aiSettings.descriptionDensity}%</span>
        </div>
        <input
          id={`${uid}-description-density`}
          type="range"
          min="0"
          max="100"
          value={aiSettings.descriptionDensity}
          onChange={(e) => updateAISettings({ descriptionDensity: Number(e.target.value) })}
          className="w-full h-1 bg-ink-700 rounded-full appearance-none cursor-pointer accent-amber-400"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={`${uid}-dialogue-density`} className="text-xs text-ink-400">对话浓度</label>
          <span className="text-xs text-amber-400">{aiSettings.dialogueDensity}%</span>
        </div>
        <input
          id={`${uid}-dialogue-density`}
          type="range"
          min="0"
          max="100"
          value={aiSettings.dialogueDensity}
          onChange={(e) => updateAISettings({ dialogueDensity: Number(e.target.value) })}
          className="w-full h-1 bg-ink-700 rounded-full appearance-none cursor-pointer accent-amber-400"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={`${uid}-strictness`} className="text-xs text-ink-400">严守设定</label>
          <span className="text-xs text-amber-400">{aiSettings.strictness}%</span>
        </div>
        <input
          id={`${uid}-strictness`}
          type="range"
          min="0"
          max="100"
          value={aiSettings.strictness}
          onChange={(e) => updateAISettings({ strictness: Number(e.target.value) })}
          className="w-full h-1 bg-ink-700 rounded-full appearance-none cursor-pointer accent-amber-400"
        />
      </div>

      <div>
        <label htmlFor={`${uid}-max-tokens`} className="text-xs text-ink-400 block mb-1.5">最大生成长度 (maxTokens)</label>
        <input
          id={`${uid}-max-tokens`}
          type="number"
          min="100"
          max="10000"
          step="100"
          value={aiSettings.maxTokens}
          onChange={(e) => updateAISettings({ maxTokens: Number(e.target.value) })}
          className="w-full px-2 py-1.5 text-xs bg-ink-700/50 text-ink-200 border border-ink-600/50 rounded focus:outline-none focus:border-amber-400/50"
          placeholder="2000"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={`${uid}-temperature`} className="text-xs text-ink-400">创造性 (Temperature)</label>
          <span className="text-[10px] text-amber-400 font-mono">{aiSettings.temperature.toFixed(1)}</span>
        </div>
        <input
          id={`${uid}-temperature`}
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={aiSettings.temperature}
          onChange={(e) => updateAISettings({ temperature: Number(e.target.value) })}
          className="w-full h-1 bg-ink-700 rounded-full appearance-none cursor-pointer accent-amber-400"
        />
        <div className="flex justify-between text-[9px] text-ink-600 mt-1">
          <span>保守</span>
          <span>均衡</span>
          <span>创意</span>
        </div>
      </div>

      <div>
        <div id={`${uid}-style-group`} className="text-xs text-ink-400 block mb-1.5">风格偏好</div>
        <div className="grid grid-cols-4 gap-1" role="group" aria-labelledby={`${uid}-style-group`}>
          {([
            { id: 'balanced', label: '均衡' },
            { id: 'action', label: '动作' },
            { id: 'psychology', label: '心理' },
            { id: 'description', label: '环境' },
          ] as const).map(style => (
            <button
              key={style.id}
              onClick={() => updateAISettings({ style: style.id })}
              className={`py-1 text-xs rounded transition-colors ${
                aiSettings.style === style.id
                  ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                  : 'bg-ink-700/50 text-ink-400 border border-transparent hover:text-ink-200'
              }`}
            >
              {style.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

export default GenerateModeSelector;
