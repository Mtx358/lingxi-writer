/**
 * 软件设置 Modal
 *
 * 一个成熟创作软件应有的全局设置入口，集中管理：
 *   - 通用：自动保存、启动行为
 *   - 外观：字体、字号、行高、主题、字数/行号显示
 *   - AI：模型供应商、密钥、风格、强度（接入现有 aiSettings）
 *   - 大纲打磨：默认诊断范围
 *
 * 数据来源：
 *   - appPreferences（持久化于 storage 'appPreferences' 键，新建项目时作为默认值）
 *   - aiSettings（持久化于 storage 'aiSettings' 键，含密钥加密）
 */
import { useState, useEffect, useRef, useId } from 'react';
import {
  X,
  Settings,
  Palette,
  Cpu,
  Wand2,
  Save,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { pushOverlay, popOverlay } from '@/utils/overlayState';
import { LLMClient } from '@/utils/llmClient';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import { confirm } from '@/hooks/useConfirm';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { AppPreferences, AISettings } from '@/types';

interface SettingsModalProps {
  onClose: () => void;
}

type Section = 'general' | 'appearance' | 'ai' | 'polish';

const FONT_OPTIONS = [
  { value: 'system-ui', label: '系统默认' },
  { value: '"PingFang SC", "Microsoft YaHei", sans-serif', label: '苹方 / 雅黑' },
  { value: '"Source Han Serif SC", "Noto Serif CJK SC", serif', label: '思源宋体' },
  { value: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif', label: '思源黑体' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
];

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const appPreferences = useAppStore(s => s.appPreferences);
  const updateAppPreferences = useAppStore(s => s.updateAppPreferences);
  const aiSettings = useAppStore(s => s.aiSettings);
  const updateAISettings = useAppStore(s => s.updateAISettings);

  const [section, setSection] = useState<Section>('general');
  const [localPrefs, setLocalPrefs] = useState<AppPreferences>(appPreferences);
  const [localAI, setLocalAI] = useState<AISettings>(aiSettings);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  // 展示测试结果详情（成功消息或失败原因），让用户区分网络错误/鉴权失败/URL 错误等
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // 跟踪组件挂载状态：testConnection / handleSave 是异步，返回时组件可能已 unmount，
  // 此时调用 setState 虽在 React 18 不再报警，但仍是无效写入；用 ref 跳过。
  const mountedRef = useRef(true);
  // 组件挂载即视为打开（由父级条件渲染控制），焦点陷阱常驻激活
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // 注册浮层，屏蔽全局快捷键
  useEffect(() => {
    pushOverlay();
    return () => popOverlay();
  }, []);

  // ESC 关闭：与点击遮罩相同的脏检查逻辑。
  // 用 ref 镜像 dirty/saving/testing/onClose，避免每次状态变化都重注册监听器
  const stateRef = useRef({ dirty, saving, testing, onClose });
  useEffect(() => {
    stateRef.current = { dirty, saving, testing, onClose };
  }, [dirty, saving, testing, onClose]);

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== 'Escape') return;
      const { dirty: d, saving: s, testing: t, onClose: close } = stateRef.current;
      if (s || t) return;
      if (d && !(await confirm('有未保存的修改，确定要放弃并关闭吗？'))) return;
      close();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  const updatePref = <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
    setLocalPrefs(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const updateAI = <K extends keyof AISettings>(key: K, value: AISettings[K]) => {
    setLocalAI(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 用 allSettled 而非 all：避免一项失败时另一项的落盘结果被吞掉，
      // 也能精准提示用户哪一项失败、哪一项已成功
      const [prefsRes, aiRes] = await Promise.allSettled([
        updateAppPreferences(localPrefs),
        updateAISettings(localAI),
      ]);
      if (!mountedRef.current) return;

      const prefsOk = prefsRes.status === 'fulfilled';
      const aiOk = aiRes.status === 'fulfilled';
      const prefsReason = prefsRes.status === 'rejected' ? prefsRes.reason : null;
      const aiReason = aiRes.status === 'rejected' ? aiRes.reason : null;

      if (prefsOk && aiOk) {
        setDirty(false);
        toast.success('设置已保存');
        onClose();
      } else if (!prefsOk && !aiOk) {
        toast.error('保存失败', '偏好与 AI 设置均未能持久化，请重试');
      } else if (!prefsOk) {
        // 偏好失败但 AI 成功：dirty 保留以提示用户重试偏好部分
        toast.error('偏好保存失败', prefsReason instanceof Error ? prefsReason.message : '请重试');
      } else {
        toast.error('AI 设置保存失败', aiReason instanceof Error ? aiReason.message : '请重试');
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setTestMessage(null);
    try {
      // 修复 P48-1：不调用 updateAISettings 落盘 store，避免用户测试后点"取消"
      // AI 设置已经持久化与取消语义冲突。直接用 localAI 临时构造一个 LLMClient
      // 实例测试，确认保存时才落盘
      const tempClient = new LLMClient();
      tempClient.updateSettings(localAI);
      const result = await tempClient.testConnection();
      if (!mountedRef.current) return;
      setTestResult(result.success ? 'ok' : 'fail');
      // 修复 P48-2：testConnection 返回 { success, message }，附带 message 让用户
      // 能区分网络错误/鉴权失败/URL 错误等不同失败原因
      setTestMessage(result.message);
    } catch (e) {
      // 修复 P48-2：读取错误对象 message，避免完全吞错；此前 catch { setTestResult('fail'); }
      // 用户无法区分失败原因
      if (!mountedRef.current) return;
      setTestResult('fail');
      setTestMessage(getErrorMessage(e));
    } finally {
      if (mountedRef.current) setTesting(false);
    }
  };

  const sections: { id: Section; label: string; icon: typeof Settings }[] = [
    { id: 'general', label: '通用', icon: Settings },
    { id: 'appearance', label: '外观', icon: Palette },
    { id: 'ai', label: 'AI 助手', icon: Cpu },
    { id: 'polish', label: '大纲打磨', icon: Wand2 },
  ];

  // 关闭前若存在未保存改动，提示用户确认，避免误点遮罩丢失编辑
  const requestClose = async () => {
    if (saving || testing) return; // 持久化/测试进行中时禁止关闭，防止半完成状态
    if (dirty && !(await confirm('有未保存的修改，确定要放弃并关闭吗？'))) return;
    onClose();
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label="软件设置"
    >
      <div
        className="w-[640px] max-h-[80vh] bg-ink-900 border border-ink-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-800/50">
          <div className="flex items-center gap-2 text-ink-100 font-medium">
            <Settings className="w-4 h-4 text-amber-400" />
            软件设置
          </div>
          <button
            onClick={requestClose}
            disabled={saving || testing}
            className="p-1 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors disabled:opacity-40"
            aria-label="关闭"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <nav className="w-40 border-r border-ink-800/50 py-2">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                  section === s.id
                    ? 'text-amber-300 bg-amber-400/10 border-r-2 border-amber-400'
                    : 'text-ink-400 hover:text-ink-200 hover:bg-ink-800/30'
                }`}
              >
                <s.icon className="w-3.5 h-3.5" />
                {s.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {section === 'general' && (
              <>
                <SectionTitle title="通用" desc="影响软件整体行为的基础设置" />
                <Field label="自动保存间隔" desc="编辑时自动保存到项目文件，0 表示禁用">
                  <select
                    value={localPrefs.autoSaveInterval}
                    onChange={e => updatePref('autoSaveInterval', Number(e.target.value))}
                    className="input text-sm py-1.5 w-48"
                  >
                    <option value={0}>禁用</option>
                    <option value={15000}>15 秒</option>
                    <option value={30000}>30 秒</option>
                    <option value={60000}>1 分钟</option>
                    <option value={300000}>5 分钟</option>
                  </select>
                </Field>
                <Field label="启动行为" desc="打开软件时是否自动恢复上次的项目">
                  <Toggle
                    checked={localPrefs.reopenLastProject}
                    onChange={v => updatePref('reopenLastProject', v)}
                    label={localPrefs.reopenLastProject ? '自动打开上次项目' : '显示项目列表'}
                  />
                </Field>
              </>
            )}

            {section === 'appearance' && (
              <>
                <SectionTitle title="外观" desc="编辑器默认外观，新建项目时套用" />
                <Field label="默认主题">
                  <select
                    value={localPrefs.defaultTheme}
                    onChange={e => updatePref('defaultTheme', e.target.value as 'dark' | 'light')}
                    className="input text-sm py-1.5 w-48"
                  >
                    <option value="dark">深色</option>
                    <option value="light">浅色</option>
                  </select>
                </Field>
                <Field label="默认字体">
                  <select
                    value={localPrefs.defaultFontFamily}
                    onChange={e => updatePref('defaultFontFamily', e.target.value)}
                    className="input text-sm py-1.5 w-56"
                  >
                    {FONT_OPTIONS.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="默认字号" desc="12-24 px">
                  <div className="flex items-center gap-2 w-56">
                    <input
                      type="range"
                      min={12}
                      max={24}
                      value={localPrefs.defaultFontSize}
                      onChange={e => updatePref('defaultFontSize', Number(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-xs text-ink-400 w-10 text-right">{localPrefs.defaultFontSize}px</span>
                  </div>
                </Field>
                <Field label="默认行高" desc="1.2 - 2.4">
                  <div className="flex items-center gap-2 w-56">
                    <input
                      type="range"
                      min={1.2}
                      max={2.4}
                      step={0.1}
                      value={localPrefs.defaultLineHeight}
                      onChange={e => updatePref('defaultLineHeight', Number(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-xs text-ink-400 w-10 text-right">{localPrefs.defaultLineHeight.toFixed(1)}</span>
                  </div>
                </Field>
                <Field label="状态显示">
                  <div className="flex gap-3">
                    <Toggle
                      checked={localPrefs.showWordCount}
                      onChange={v => updatePref('showWordCount', v)}
                      label="字数统计"
                    />
                    <Toggle
                      checked={localPrefs.showLineNumbers}
                      onChange={v => updatePref('showLineNumbers', v)}
                      label="行号"
                    />
                  </div>
                </Field>
              </>
            )}

            {section === 'ai' && (
              <>
                <SectionTitle title="AI 助手" desc="配置模型供应商与生成风格" />
                <Field label="模型供应商">
                  <select
                    value={localAI.provider}
                    onChange={e => updateAI('provider', e.target.value as AISettings['provider'])}
                    aria-label="模型供应商"
                    className="input text-sm py-1.5 w-48"
                  >
                    <option value="mock">Mock（离线演示）</option>
                    <option value="openai">OpenAI 兼容</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="local">本地模型</option>
                  </select>
                </Field>
                {localAI.provider !== 'mock' && (
                  <>
                    <Field label="API Base URL" desc="OpenAI 兼容协议的接口地址">
                      <input
                        value={localAI.baseUrl || ''}
                        onChange={e => updateAI('baseUrl', e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="input text-sm py-1.5 w-full"
                      />
                    </Field>
                    <Field label="API Key" desc="密钥会通过 Electron safeStorage 加密落盘">
                      <div className="flex gap-1 w-full">
                        <input
                          type={showApiKey ? 'text' : 'password'}
                          value={localAI.apiKey || ''}
                          onChange={e => updateAI('apiKey', e.target.value)}
                          placeholder="sk-..."
                          className="input text-sm py-1.5 flex-1"
                        />
                        <button
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="px-2 py-1 bg-ink-800 text-ink-400 hover:text-ink-200 rounded text-xs"
                          title={showApiKey ? '隐藏' : '显示'}
                          aria-label="显示或隐藏 API Key"
                        >
                          {showApiKey ? <EyeOff className="w-3.5 h-3.5" aria-hidden="true" /> : <Eye className="w-3.5 h-3.5" aria-hidden="true" />}
                        </button>
                      </div>
                    </Field>
                    <Field label="模型名">
                      <input
                        value={localAI.model || ''}
                        onChange={e => updateAI('model', e.target.value)}
                        placeholder="gpt-4o-mini / deepseek-chat / qwen-plus"
                        className="input text-sm py-1.5 w-full"
                      />
                    </Field>
                  </>
                )}
                <Field label="写作风格">
                  <select
                    value={localAI.style}
                    onChange={e => updateAI('style', e.target.value as AISettings['style'])}
                    aria-label="写作风格"
                    className="input text-sm py-1.5 w-48"
                  >
                    <option value="balanced">均衡</option>
                    <option value="action">动作向</option>
                    <option value="psychology">心理向</option>
                    <option value="description">环境向</option>
                  </select>
                </Field>
                <Field label="描写浓度" desc="0=精简，100=丰富">
                  <Slider label="描写浓度" value={localAI.descriptionDensity} onChange={v => updateAI('descriptionDensity', v)} />
                </Field>
                <Field label="对话浓度" desc="0=较少，100=较多">
                  <Slider label="对话浓度" value={localAI.dialogueDensity} onChange={v => updateAI('dialogueDensity', v)} />
                </Field>
                <Field label="AI 痕迹严格度" desc="越高越严格（适合投各大平台）">
                  <Slider label="AI 痕迹严格度" value={localAI.strictness} onChange={v => updateAI('strictness', v)} />
                </Field>
                <Field label="随机性 temperature" desc="0=确定，1=发散">
                  <Slider label="随机性 temperature" value={localAI.temperature} onChange={v => updateAI('temperature', v)} min={0} max={1} step={0.1} />
                </Field>
                <Field label="最大 token 数">
                  <input
                    type="number"
                    min={500}
                    max={8000}
                    step={100}
                    value={localAI.maxTokens}
                    // 空字符串（清空输入框）会得到 0，需回退到合理默认值，避免
                    // 提交 0 给 LLM 触发参数校验失败
                    onChange={e => {
                      const n = Number(e.target.value);
                      updateAI('maxTokens', Number.isFinite(n) && n > 0 ? n : 1000);
                    }}
                    className="input text-sm py-1.5 w-32"
                  />
                </Field>
                <Field label="冲突检测" desc="AI 生成内容后自动检测人物/设定冲突">
                  <Toggle
                    checked={localAI.autoCheckConflicts}
                    onChange={v => updateAI('autoCheckConflicts', v)}
                    label={localAI.autoCheckConflicts ? '启用' : '禁用'}
                  />
                </Field>
                {localAI.provider !== 'mock' && (
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={handleTestConnection}
                      disabled={testing}
                      className="px-3 py-1.5 text-xs bg-ink-800 text-ink-200 hover:bg-ink-700 rounded flex items-center gap-1 disabled:opacity-50"
                    >
                      {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      测试连接
                    </button>
                    {testResult === 'ok' && (
                      <span className="text-xs text-emerald-300 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> {testMessage || '连接成功'}
                      </span>
                    )}
                    {testResult === 'fail' && (
                      <span className="text-xs text-red-300" title={testMessage || undefined}>
                        {testMessage || '连接失败，请检查配置'}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}

            {section === 'polish' && (
              <>
                <SectionTitle title="大纲打磨" desc="默认诊断范围与建议行为" />
                <Field label="默认诊断范围" desc="点击「全面分析」时默认作用范围">
                  <select
                    value={localPrefs.defaultPolishScope}
                    onChange={e => updatePref('defaultPolishScope', e.target.value as 'all' | 'current')}
                    className="input text-sm py-1.5 w-48"
                  >
                    <option value="all">全量大纲</option>
                    <option value="current">当前章节</option>
                  </select>
                </Field>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-ink-800/50 bg-ink-900/80">
          <span className="text-[11px] text-ink-500">
            {saving ? '正在保存…' : dirty ? '有未保存的改动' : '所有设置已保存'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={requestClose}
              disabled={saving}
              className="px-3 py-1.5 text-xs bg-ink-800 text-ink-300 hover:bg-ink-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-3 py-1.5 text-xs bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 rounded transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save className="w-3 h-3" />
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <div className="text-sm font-medium text-ink-100">{title}</div>
      <div className="text-[11px] text-ink-500 mt-0.5">{desc}</div>
    </div>
  );
}

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink-200">{label}</div>
        {desc && <div className="text-[10px] text-ink-500 mt-0.5">{desc}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  const switchId = useId();
  return (
    <label htmlFor={switchId} className="flex items-center gap-2 cursor-pointer">
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`w-9 h-5 rounded-full transition-colors relative ${checked ? 'bg-amber-400' : 'bg-ink-700'}`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </button>
      {label && <span className="text-xs text-ink-300">{label}</span>}
    </label>
  );
}

function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2 w-56">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1"
        aria-label={label}
        aria-valuetext={max === 100 ? `${value}%` : undefined}
      />
      <span className="text-xs text-ink-400 w-10 text-right">{value}</span>
    </div>
  );
}
