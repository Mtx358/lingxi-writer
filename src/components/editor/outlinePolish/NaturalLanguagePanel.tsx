/**
 * 自然语言命令面板（规格书阶段5-1 + 第二档-8）
 *
 * 阶段5-1：自然语言修改指令——说人话就能改
 *   - AI 自动识别修改对象、生效节点、事件类型（三个语义槽位）
 *   - 用户可确认/修正槽位后再执行，而不是直接把整句丢给 LLM 跑
 *   - 核心原则：AI 负责算力（解析），人类负责判断（确认/修正）
 *
 * 第二档-8：说什么就跳到哪——AI 把口语解析成跳转意图，确认后直达对应 Tab / 章节。
 */
import { useState, useCallback, useRef } from 'react';
import { MessageSquare, Send, CornerDownRight, History, Edit3, Check } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { parseNaturalLanguageCommand, type NLCommandIntent, type NLCommandSlots } from '@/utils/aiService/polishTools';
import { toast } from '@/hooks/useToast';
import { Section, EmptyHint } from './shared';

const RECENT_KEY = 'polish:nlRecent';

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    // ignore
  }
}

const SLOT_LABELS: Array<{ key: keyof NLCommandSlots; label: string; desc: string }> = [
  { key: 'modificationTarget', label: '修改对象', desc: '对什么动手（角色/伏笔/设定/章节）' },
  { key: 'effectiveNode', label: '生效节点', desc: '在哪一章/哪个阶段生效' },
  { key: 'eventType', label: '事件类型', desc: '做什么改动（死亡/换身份/提前/延后…）' },
];

export function NaturalLanguagePanel() {
  const chapters = useAppStore(s => s.chapters);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [intent, setIntent] = useState<NLCommandIntent | null>(null);
  // 可编辑的槽位副本：用户可在执行前修正 AI 解析结果
  const [editableSlots, setEditableSlots] = useState<NLCommandSlots | null>(null);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const inputRef = useRef<HTMLInputElement>(null);

  const handleParse = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true);
    setIntent(null);
    setEditableSlots(null);
    try {
      const result = await parseNaturalLanguageCommand({ input: trimmed, chapters });
      setIntent(result);
      // 把 AI 解析的槽位复制到可编辑副本
      if (result.slots) {
        setEditableSlots({ ...result.slots });
      }
      // 记录到最近命令
      const next = [trimmed, ...recent.filter(r => r !== trimmed)].slice(0, 8);
      setRecent(next);
      saveRecent(next);
    } catch {
      toast.error('解析失败', '请检查 API 配置后重试');
    } finally {
      setLoading(false);
    }
  }, [chapters, recent]);

  // 槽位修正：用户编辑某个槽位
  const handleSlotChange = useCallback((key: keyof NLCommandSlots, value: string) => {
    setEditableSlots(prev => prev ? { ...prev, [key]: value } : null);
  }, []);

  // 重置槽位到 AI 原始解析结果
  const handleResetSlots = useCallback(() => {
    if (intent?.slots) {
      setEditableSlots({ ...intent.slots });
    }
  }, [intent]);

  const handleExecute = useCallback(() => {
    if (!intent) return;
    // 复用打磨台统一的跳转机制：localStorage + storage 事件
    localStorage.setItem('polish:targetTab', intent.targetTab);
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'polish:targetTab',
      newValue: intent.targetTab,
    }));
    if (intent.targetChapterId) {
      localStorage.setItem('polish:targetChapter', intent.targetChapterId);
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'polish:targetChapter',
        newValue: intent.targetChapterId,
      }));
    }
    // 把修正后的槽位也带到目标 Tab，让执行端拿到结构化参数
    if (editableSlots) {
      localStorage.setItem('polish:nlSlots', JSON.stringify(editableSlots));
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'polish:nlSlots',
        newValue: JSON.stringify(editableSlots),
      }));
    }
    const slotSummary = editableSlots
      ? `（${editableSlots.modificationTarget} · ${editableSlots.effectiveNode} · ${editableSlots.eventType}）`
      : '';
    toast.success('已按确认参数执行', `${intent.interpretation}${slotSummary}`);
  }, [intent, editableSlots]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    handleParse(input);
  }, [input, handleParse]);

  return (
    <Section
      icon={MessageSquare}
      title="自然语言命令"
      desc="说人话就能改——AI 拆出修改对象/生效节点/事件类型，你确认后再执行"
    >
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="例如：让导师在第 8 章提前牺牲 / 把女主的身份换成卧底"
          className="flex-1 px-3 py-2 text-sm bg-ink-900/60 border border-ink-700 rounded-md text-ink-100 placeholder:text-ink-600 focus:outline-none focus:border-amber-400/50"
          aria-label="自然语言命令输入"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-3 py-2 text-sm bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 rounded-md flex items-center gap-1 disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          解析
        </button>
      </form>

      {/* 解析结果 */}
      {loading && (
        <div className="text-xs text-ink-500 text-center py-3">AI 正在理解你的意图…</div>
      )}
      {intent && !loading && (
        <div className="p-3 rounded-lg bg-ink-800/40 border border-ink-700/50 space-y-3">
          {/* 意图复述 */}
          <div className="flex items-start gap-2">
            <CornerDownRight className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-ink-200">{intent.interpretation}</div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-ink-500 flex-wrap">
                <span>目标：{intent.targetTab}</span>
                {intent.targetChapterId && (
                  <span>· 章节：{chapters.find(c => c.id === intent.targetChapterId)?.title || '已定位'}</span>
                )}
                <span>· 置信度 {Math.round(intent.confidence * 100)}%</span>
              </div>
            </div>
          </div>

          {/* 语义槽位（可编辑）：修改对象 / 生效节点 / 事件类型 */}
          {editableSlots && (
            <div className="space-y-1.5 pt-1 border-t border-ink-700/50">
              <div className="flex items-center gap-1.5 text-[10px] text-ink-400">
                <Edit3 className="w-2.5 h-2.5 text-amber-400" />
                <span>语义槽位（请确认/修正后再执行）</span>
                <button
                  onClick={handleResetSlots}
                  className="ml-auto text-[9px] text-ink-500 hover:text-ink-300 underline"
                  title="重置为 AI 原始解析结果"
                >
                  重置
                </button>
              </div>
              {SLOT_LABELS.map(({ key, label, desc }) => (
                <div key={key} className="flex items-center gap-2">
                  <label
                    htmlFor={`nl-slot-${key}`}
                    className="text-[10px] text-ink-400 w-16 flex-shrink-0"
                    title={desc}
                  >
                    {label}
                  </label>
                  <input
                    id={`nl-slot-${key}`}
                    value={editableSlots[key]}
                    onChange={e => handleSlotChange(key, e.target.value)}
                    className="flex-1 px-2 py-1 text-[11px] bg-ink-900/60 border border-ink-700/60 rounded text-ink-100 focus:outline-none focus:border-amber-400/50"
                    aria-label={`${label}：${desc}`}
                  />
                </div>
              ))}
              <div className="text-[9px] text-ink-600 leading-relaxed pl-[72px]">
                AI 负责算力（解析），人类负责判断（确认/修正）。三个槽位都核对无误后再执行。
              </div>
            </div>
          )}

          {/* 执行按钮 */}
          <button
            onClick={handleExecute}
            className="w-full px-3 py-1.5 text-xs bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 rounded transition-colors flex items-center justify-center gap-1.5"
          >
            <Check className="w-3 h-3" />
            {editableSlots ? '按这些参数执行' : '确认跳转'}
          </button>
        </div>
      )}

      {/* 最近命令 */}
      {recent.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-ink-600">
            <History className="w-2.5 h-2.5" />
            最近命令
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((cmd, idx) => (
              <button
                key={idx}
                onClick={() => { setInput(cmd); handleParse(cmd); }}
                className="text-[10px] px-2 py-1 bg-ink-800/50 text-ink-400 hover:text-ink-200 hover:bg-ink-800 rounded transition-colors max-w-[200px] truncate"
                title={cmd}
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>
      )}

      {!intent && !loading && recent.length === 0 && (
        <EmptyHint icon={MessageSquare} text="输入你想改的内容，AI 会拆出修改对象/生效节点/事件类型，你确认后再执行" />
      )}
    </Section>
  );
}

export default NaturalLanguagePanel;
