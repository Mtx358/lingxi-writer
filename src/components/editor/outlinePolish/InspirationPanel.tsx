/**
 * 灵感打磨面板（规格书第一阶段）
 *
 * 整合三个子功能到一个组件，通过内部 tab 切换：
 *   - capture 碎片捕获 + 卡片促活：灵感卡的增删/筛选/搜索，深度提问与子卡生成
 *   - sandbox 连线沙盘：在两张卡片之间生成叙事脉络
 *
 * Store 依赖（inspirationSlice）：
 *   inspirationCards / storyLinks / isInspirationBusy
 *   addInspirationCard / updateInspirationCard / deleteInspirationCard
 *   askInspirationCard / addInspirationChildCard
 *   createStoryLink / deleteStoryLink
 */
import { useMemo, useState } from 'react';
import {
  Lightbulb, Sparkles, Plus, Search, Trash2, Loader2,
  Link2, ChevronDown, ChevronRight, HelpCircle, Clock, ArrowRight, BookOpen,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { InspirationCard, InspirationCardType, InspirationCardStatus, MaterialQuestion } from '@/types';

/** 灵感卡类型中文标签 */
const CARD_TYPE_LABELS: Record<InspirationCardType, string> = {
  character: '人物种子',
  concept: '高概念',
  scene: '场景片段',
  dialogue: '对话金句',
  setting: '设定疑问',
  plot: '情节脑洞',
};

/** 灵感卡类型配色（标签用） */
const CARD_TYPE_COLORS: Record<InspirationCardType, string> = {
  character: 'text-purple-300 bg-purple-400/10 border-purple-500/30',
  concept: 'text-amber-300 bg-amber-400/10 border-amber-500/30',
  scene: 'text-cyan-300 bg-cyan-400/10 border-cyan-500/30',
  dialogue: 'text-pink-300 bg-pink-400/10 border-pink-500/30',
  setting: 'text-blue-300 bg-blue-400/10 border-blue-500/30',
  plot: 'text-emerald-300 bg-emerald-400/10 border-emerald-500/30',
};

const CARD_TYPES: InspirationCardType[] = ['character', 'concept', 'scene', 'dialogue', 'setting', 'plot'];

/** 灵感卡生命周期状态标签 */
const STATUS_LABELS: Record<InspirationCardStatus, string> = {
  pending: '待开发',
  outlined: '已接入大纲',
  written: '已写入正文',
  archived: '暂弃',
};

/** 灵感卡状态配色（徽章用） */
const STATUS_COLORS: Record<InspirationCardStatus, string> = {
  pending: 'text-ink-400 bg-ink-700/40 border-ink-600/40',
  outlined: 'text-cyan-300 bg-cyan-400/10 border-cyan-500/30',
  written: 'text-emerald-300 bg-emerald-400/10 border-emerald-500/30',
  archived: 'text-ink-500 bg-ink-800/40 border-ink-700/40',
};

const STATUS_OPTIONS: InspirationCardStatus[] = ['pending', 'outlined', 'written', 'archived'];

/** 闲置提醒阈值：超过此天数未使用的 pending 卡触发提醒（规格书示例为 21 天） */
const IDLE_THRESHOLD_DAYS = 21;

type TabKey = 'capture' | 'sandbox';

export default function InspirationPanel() {
  const [tab, setTab] = useState<TabKey>('capture');

  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-0.5 bg-ink-800/40 rounded-lg">
        {(['capture', 'sandbox'] as TabKey[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
              tab === t ? 'bg-amber-400/20 text-amber-200' : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            {t === 'capture' ? '碎片捕获 · 卡片促活' : '连线沙盘'}
          </button>
        ))}
      </div>

      {tab === 'capture' ? <CaptureTab /> : <SandboxTab />}
    </div>
  );
}

// ============================================================================
// capture tab：碎片捕获 + 卡片促活
// ============================================================================

/** 转化率统计栏：实时显示灵感卡全链路转化情况 */
function ConversionStatsBar({ stats }: {
  stats: {
    total: number; pending: number; outlined: number; written: number; archived: number;
    rate: number; denominator: number;
  };
}) {
  if (stats.total === 0) return null;
  return (
    <div className="p-2 bg-ink-800/40 border border-ink-700/50 rounded-lg">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-ink-200 font-medium">{stats.total} 张灵感卡</span>
        <span className="text-ink-600">·</span>
        <span className="text-cyan-300">{stats.outlined} 已接入大纲</span>
        <span className="text-ink-600">·</span>
        <span className="text-emerald-300">{stats.written} 已写入正文</span>
        {stats.pending > 0 && (
          <>
            <span className="text-ink-600">·</span>
            <span className="text-ink-400">{stats.pending} 待开发</span>
          </>
        )}
        {stats.archived > 0 && (
          <>
            <span className="text-ink-600">·</span>
            <span className="text-ink-500">{stats.archived} 暂弃</span>
          </>
        )}
        {/* 转化率进度条 */}
        <div className="w-full mt-1 flex items-center gap-1.5">
          <div className="flex-1 h-1.5 bg-ink-700/50 rounded-full overflow-hidden flex">
            {stats.outlined > 0 && (
              <div className="bg-cyan-400/60" style={{ width: `${(stats.outlined / stats.denominator) * 100}%` }} />
            )}
            {stats.written > 0 && (
              <div className="bg-emerald-400/60" style={{ width: `${(stats.written / stats.denominator) * 100}%` }} />
            )}
          </div>
          <span className="text-[10px] text-amber-300 font-medium whitespace-nowrap">{stats.rate}%</span>
        </div>
      </div>
    </div>
  );
}

function CaptureTab() {
  const cards = useAppStore(s => s.inspirationCards);
  const addCard = useAppStore(s => s.addInspirationCard);
  const updateCard = useAppStore(s => s.updateInspirationCard);
  const deleteCard = useAppStore(s => s.deleteInspirationCard);
  const askCard = useAppStore(s => s.askInspirationCard);
  const addChildCard = useAppStore(s => s.addInspirationChildCard);
  const promoteToChapter = useAppStore(s => s.promoteInspirationToChapter);

  const [filterType, setFilterType] = useState<InspirationCardType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<InspirationCardStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 新建表单
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<InspirationCardType>('concept');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');

  // 深度提问
  const isBusy = useAppStore(s => s.isInspirationBusy);
  const [questions, setQuestions] = useState<MaterialQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [asking, setAsking] = useState(false);

  // 主卡（无 parentId），子卡挂在其下
  const mainCards = useMemo(() => cards.filter(c => !c.parentId), [cards]);

  // 转化率统计（规格书阶段1：全链路转化率追踪）
  const conversionStats = useMemo(() => {
    const total = mainCards.length;
    const byStatus = { pending: 0, outlined: 0, written: 0, archived: 0 };
    for (const c of mainCards) {
      const s = c.status ?? 'pending';
      byStatus[s]++;
    }
    // 转化率分母排除 archived（暂弃不参与统计）
    const denominator = total - byStatus.archived;
    const converted = byStatus.outlined + byStatus.written;
    const rate = denominator > 0 ? Math.round((converted / denominator) * 100) : 0;
    return { total, ...byStatus, rate, denominator };
  }, [mainCards]);

  // 闲置提醒：pending 状态且创建超过 IDLE_THRESHOLD_DAYS 天的主卡
  const idleCards = useMemo(() => {
    const now = Date.now();
    const thresholdMs = IDLE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    return mainCards.filter(c => {
      const s = c.status ?? 'pending';
      if (s !== 'pending') return false;
      const created = new Date(c.createdAt).getTime();
      return (now - created) >= thresholdMs;
    });
  }, [mainCards]);

  const filtered = useMemo(() => {
    return mainCards.filter(c => {
      if (filterType !== 'all' && c.type !== filterType) return false;
      if (filterStatus !== 'all' && (c.status ?? 'pending') !== filterStatus) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!c.title.toLowerCase().includes(q) && !c.content.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [mainCards, filterType, filterStatus, searchQuery]);

  // 子卡按 parentId 分组：此前在 filtered.map 内逐卡 filter(cards)（O(visible × total) per render），
  // 改为单次遍历预计算 Map，render 时直接 get(parentId)
  const childCardsByParent = useMemo(() => {
    const map = new Map<string, InspirationCard[]>();
    for (const c of cards) {
      if (c.parentId) {
        const arr = map.get(c.parentId);
        if (arr) arr.push(c);
        else map.set(c.parentId, [c]);
      }
    }
    return map;
  }, [cards]);

  const selected = cards.find(c => c.id === selectedId) || null;
  const childrenOfSelected = useMemo(
    () => (selected ? cards.filter(c => c.parentId === selected.id) : []),
    [cards, selected],
  );

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (!formTitle.trim()) return;
    const card = addCard({ type: formType, title: formTitle.trim(), content: formContent.trim() });
    setSelectedId(card.id);
    setFormTitle('');
    setFormContent('');
    setFormType('concept');
    setShowForm(false);
  };

  const handleAsk = async () => {
    if (!selected) return;
    setAsking(true);
    setQuestions([]);
    setAnswers({});
    try {
      const qs = await askCard(selected.id);
      setQuestions(qs);
    } finally {
      setAsking(false);
    }
  };

  const handleAnswer = (idx: number, q: MaterialQuestion) => {
    const answer = (answers[idx] || '').trim();
    if (!answer || !selected) return;
    addChildCard(selected.id, q.dimension, q.question, answer);
    setAnswers(prev => ({ ...prev, [idx]: '' }));
  };

  const handleDelete = (card: InspirationCard) => {
    const label = card.childCount ? `及其 ${card.childCount} 张子卡` : '';
    if (!window.confirm(`确定删除「${card.title}」${label}？此操作不可撤销。`)) return;
    deleteCard(card.id);
    if (selectedId === card.id) {
      setSelectedId(null);
      setQuestions([]);
    }
  };

  return (
    <div className="space-y-2">
      {/* 转化率统计栏（规格书阶段1：全链路转化率追踪） */}
      <ConversionStatsBar stats={conversionStats} />

      {/* 闲置提醒（pending 超过 21 天的主卡） */}
      {idleCards.length > 0 && (
        <div className="p-2 bg-amber-400/5 border border-amber-500/20 rounded-lg space-y-1">
          <div className="flex items-center gap-1 text-[11px] text-amber-300">
            <Clock className="w-3 h-3" />
            闲置提醒 · {idleCards.length} 张灵感卡超过 {IDLE_THRESHOLD_DAYS} 天未使用
          </div>
          {idleCards.slice(0, 3).map(card => {
            const days = Math.floor((Date.now() - new Date(card.createdAt).getTime()) / (24 * 60 * 60 * 1000));
            return (
              <div key={card.id} className="flex items-center gap-1.5 text-[11px] text-ink-300">
                <span className="truncate flex-1">「{card.title || '无标题'}」已存 {days} 天</span>
                <button
                  onClick={() => {
                    updateCard(card.id, { status: 'outlined' });
                    setSelectedId(card.id);
                  }}
                  className="px-1.5 py-0.5 text-[10px] bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20 rounded flex items-center gap-0.5 whitespace-nowrap"
                >
                  安排进大纲
                  <ArrowRight className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}
          {idleCards.length > 3 && (
            <div className="text-[10px] text-ink-500">还有 {idleCards.length - 3} 张…</div>
          )}
        </div>
      )}

      {/* 顶部操作栏 */}
      <div className="flex items-center gap-1.5">
        <select
          aria-label="筛选类型"
          value={filterType}
          onChange={e => setFilterType(e.target.value as InspirationCardType | 'all')}
          className="input text-[11px] py-1 flex-1"
        >
          <option value="all">全部类型</option>
          {CARD_TYPES.map(t => (
            <option key={t} value={t}>{CARD_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <select
          aria-label="筛选状态"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as InspirationCardStatus | 'all')}
          className="input text-[11px] py-1 flex-1"
        >
          <option value="all">全部状态</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-2 py-1 text-[11px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center gap-1 whitespace-nowrap"
        >
          <Plus className="w-3 h-3" />
          新建灵感
        </button>
      </div>

      <div className="relative">
        <Search className="w-3 h-3 text-ink-500 absolute left-2 top-1/2 -translate-y-1/2" />
        <input
          aria-label="搜索灵感卡"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="搜索标题或内容…"
          className="input text-[11px] py-1 pl-6 w-full"
        />
      </div>

      {/* 新建表单 */}
      {showForm && (
        <div className="p-2.5 bg-ink-800/40 border border-amber-500/20 rounded-lg space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-ink-400">类型</span>
            <select
              aria-label="灵感卡类型"
              value={formType}
              onChange={e => setFormType(e.target.value as InspirationCardType)}
              className="input text-[11px] py-1 flex-1"
            >
              {CARD_TYPES.map(t => (
                <option key={t} value={t}>{CARD_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <input
            aria-label="灵感卡标题"
            value={formTitle}
            onChange={e => setFormTitle(e.target.value)}
            placeholder="一句话标题（保留你的原始语气）"
            className="input text-[11px] py-1 w-full"
          />
          <textarea
            aria-label="灵感卡内容"
            value={formContent}
            onChange={e => setFormContent(e.target.value)}
            placeholder="详细内容：语音转写、短句、粘贴均可…"
            rows={3}
            className="input text-[11px] py-1 w-full resize-none"
          />
          <div className="flex justify-end gap-1.5">
            <button
              onClick={() => setShowForm(false)}
              className="px-2 py-1 text-[11px] text-ink-400 hover:text-ink-200"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={!formTitle.trim()}
              className="px-2 py-1 text-[11px] bg-amber-400/20 text-amber-200 hover:bg-amber-400/30 rounded disabled:opacity-40"
            >
              创建
            </button>
          </div>
        </div>
      )}

      {/* 主体：左列表 + 右详情 */}
      <div className="flex gap-2">
        <div className="w-2/5 min-w-0 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-4 text-center">
              <Lightbulb className="w-7 h-7 text-ink-600 mx-auto mb-1.5" />
              <p className="text-[11px] text-ink-500">
                {mainCards.length === 0 ? '还没有灵感碎片，点击「新建灵感」捕获第一个念头' : '当前筛选下无匹配卡片'}
              </p>
            </div>
          ) : (
            filtered.map(card => {
              const childCards = childCardsByParent.get(card.id) ?? [];
              const expanded = expandedIds.has(card.id);
              return (
                <div key={card.id}>
                  <CardListItem
                    card={card}
                    active={selectedId === card.id}
                    onClick={() => {
                      setSelectedId(card.id);
                      setQuestions([]);
                    }}
                    onDelete={() => handleDelete(card)}
                    expandable={childCards.length > 0}
                    expanded={expanded}
                    onToggleExpand={() => toggleExpand(card.id)}
                  />
                  {expanded && childCards.length > 0 && (
                    <div className="ml-3 mt-0.5 space-y-0.5 border-l border-ink-700/50 pl-2">
                      {childCards.map(ch => (
                        <CardListItem
                          key={ch.id}
                          card={ch}
                          active={selectedId === ch.id}
                          compact
                          onClick={() => {
                            setSelectedId(ch.id);
                            setQuestions([]);
                          }}
                          onDelete={() => handleDelete(ch)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex-1 min-w-0">
          {selected ? (
            <CardDetail
              card={selected}
              childrenCards={childrenOfSelected}
              isBusy={isBusy || asking}
              questions={questions}
              answers={answers}
              onAsk={handleAsk}
              onAnswerChange={(idx, val) => setAnswers(prev => ({ ...prev, [idx]: val }))}
              onSubmitAnswer={handleAnswer}
              onStatusChange={(status) => updateCard(selected.id, { status })}
              onPromoteToChapter={() => promoteToChapter(selected.id)}
            />
          ) : (
            <div className="p-6 text-center">
              <Sparkles className="w-7 h-7 text-ink-600 mx-auto mb-1.5" />
              <p className="text-[11px] text-ink-500">选择左侧卡片查看详情，或深度提问促活灵感</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 卡片列表项 */
function CardListItem({
  card,
  active,
  onClick,
  onDelete,
  expandable,
  expanded,
  onToggleExpand,
  compact,
}: {
  card: InspirationCard;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`灵感卡：${card.title || CARD_TYPE_LABELS[card.type]}`}
      className={`group p-2 rounded border cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-amber-400/50 ${
        active
          ? 'bg-amber-400/10 border-amber-500/40'
          : 'bg-ink-800/30 border-ink-700/40 hover:bg-ink-800/60'
      }`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-center gap-1 mb-0.5">
        {expandable && (
          <button
            onClick={e => {
              e.stopPropagation();
              onToggleExpand?.();
            }}
            aria-label={expanded ? '折叠子卡' : '展开子卡'}
            aria-expanded={expanded}
            className="text-ink-500 hover:text-ink-200"
          >
            {expanded ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
          </button>
        )}
        <span className={`px-1 py-px text-[9px] rounded border ${CARD_TYPE_COLORS[card.type]}`}>
          {CARD_TYPE_LABELS[card.type]}
        </span>
        {!compact && (() => {
          const s = card.status ?? 'pending';
          // pending 不显示徽章（默认状态），仅 outlined/written/archived 显示
          if (s === 'pending') return null;
          return (
            <span className={`px-1 py-px text-[9px] rounded border ${STATUS_COLORS[s]}`}>
              {STATUS_LABELS[s]}
            </span>
          );
        })()}
        {card.dimension && (
          <span className="px-1 py-px text-[9px] rounded bg-ink-700/40 text-ink-400 border border-ink-700/40">
            {card.dimension}
          </span>
        )}
        <button
          onClick={e => {
            e.stopPropagation();
            onDelete();
          }}
          className="ml-auto text-ink-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
          title="删除"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className={`text-[11px] text-ink-100 truncate ${compact ? 'pl-0' : ''}`}>
        {card.title || '（无标题）'}
      </div>
      {!compact && card.content && (
        <div className="text-[10px] text-ink-500 truncate mt-0.5">{card.content}</div>
      )}
      <div className="flex items-center justify-between mt-0.5">
        <span className="text-[9px] text-ink-600">{formatTime(card.createdAt)}</span>
        {!!card.childCount && card.childCount > 0 && (
          <span className="text-[9px] text-amber-400/80">{card.childCount} 张子卡</span>
        )}
      </div>
    </div>
  );
}

/** 卡片详情 */
function CardDetail({
  card,
  childrenCards,
  isBusy,
  questions,
  answers,
  onAsk,
  onAnswerChange,
  onSubmitAnswer,
  onStatusChange,
  onPromoteToChapter,
}: {
  card: InspirationCard;
  childrenCards: InspirationCard[];
  isBusy: boolean;
  questions: MaterialQuestion[];
  answers: Record<number, string>;
  onAsk: () => void;
  onAnswerChange: (idx: number, val: string) => void;
  onSubmitAnswer: (idx: number, q: MaterialQuestion) => void;
  onStatusChange: (status: InspirationCardStatus) => void;
  onPromoteToChapter: () => void;
}) {
  const currentStatus = card.status ?? 'pending';
  return (
    <div className="p-2.5 bg-ink-800/30 border border-ink-700/50 rounded-lg space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`px-1.5 py-0.5 text-[10px] rounded border ${CARD_TYPE_COLORS[card.type]}`}>
          {CARD_TYPE_LABELS[card.type]}
        </span>
        {card.dimension && (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-ink-700/40 text-ink-300 border border-ink-700/40">
            {card.dimension}
          </span>
        )}
        {/* 生命周期状态选择器（规格书阶段1：转化率追踪） */}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[10px] text-ink-500">状态</span>
          <select
            aria-label="状态"
            value={currentStatus}
            onChange={e => onStatusChange(e.target.value as InspirationCardStatus)}
            className={`text-[10px] px-1 py-0.5 rounded border ${STATUS_COLORS[currentStatus]} cursor-pointer`}
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <span className="text-[10px] text-ink-600 w-full">{formatTime(card.createdAt)}</span>
      </div>

      <div className="text-sm text-ink-100 font-medium leading-snug">{card.title || '（无标题）'}</div>
      <div className="text-[11px] text-ink-300 leading-relaxed whitespace-pre-wrap">
        {card.content || <span className="text-ink-600">（暂无详细内容）</span>}
      </div>

      {/* 升级为章节：灵感卡→大纲桥接，将卡片内容直接写入新章节正文 */}
      <button
        onClick={onPromoteToChapter}
        className="w-full px-2 py-1 text-[11px] bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20 rounded flex items-center justify-center gap-1 transition-colors"
        title="将此灵感卡升级为大纲章节，卡片内容写入正文"
      >
        <BookOpen className="w-3 h-3" />
        {card.relatedChapterId ? '已关联章节，再次升级将新建' : '升级为章节'}
      </button>

      {/* 深度提问（仅主卡可用） */}
      {!card.parentId && (
        <div className="pt-1 border-t border-ink-700/40">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1 text-[11px] text-amber-300">
              <HelpCircle className="w-3.5 h-3.5" />
              卡片促活 · 深度提问
            </div>
            <button
              onClick={onAsk}
              disabled={isBusy}
              className="px-2 py-0.5 text-[10px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center gap-1 disabled:opacity-50"
            >
              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {questions.length > 0 ? '重新提问' : '深度提问'}
            </button>
          </div>

          {questions.length > 0 ? (
            <div className="space-y-2" role="status" aria-live="polite" aria-label="深度提问结果">
              {questions.map((q, idx) => (
                <div key={idx} className="p-2 bg-ink-800/40 rounded border border-ink-700/40">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="px-1 py-px text-[9px] rounded bg-purple-400/10 text-purple-300 border border-purple-500/20">
                      {q.dimension}
                    </span>
                    <span className="text-[11px] text-ink-200 leading-snug">{q.question}</span>
                  </div>
                  <textarea
                    aria-label="回答"
                    value={answers[idx] || ''}
                    onChange={e => onAnswerChange(idx, e.target.value)}
                    placeholder={`回答关于「${q.dimension}」的问题，提交后生成子卡…`}
                    rows={2}
                    className="input text-[11px] py-1 w-full resize-none"
                  />
                  <div className="flex justify-end mt-1">
                    <button
                      onClick={() => onSubmitAnswer(idx, q)}
                      disabled={!(answers[idx] || '').trim()}
                      className="px-2 py-0.5 text-[10px] bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 rounded disabled:opacity-40 flex items-center gap-1"
                    >
                      <Plus className="w-2.5 h-2.5" />
                      回答并生成子卡
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-ink-600">
              点击「深度提问」让 AI 从秘密 / 创伤 / 伪装 / 动机等维度追问，回答会沉淀为子卡。
            </p>
          )}
        </div>
      )}

      {/* 子卡列表 */}
      {!card.parentId && (
        <div className="pt-1 border-t border-ink-700/40">
          <div className="text-[11px] text-ink-400 mb-1">子卡（{childrenCards.length}）</div>
          {childrenCards.length === 0 ? (
            <p className="text-[10px] text-ink-600">暂无子卡，通过深度提问生成</p>
          ) : (
            <div className="space-y-1">
              {childrenCards.map(ch => (
                <div key={ch.id} className="p-1.5 bg-ink-800/40 rounded text-[11px]">
                  <span className="px-1 py-px text-[9px] rounded bg-purple-400/10 text-purple-300 border border-purple-500/20 mr-1">
                    {ch.dimension}
                  </span>
                  <span className="text-ink-300">{truncate(ch.content, 40)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// sandbox tab：连线沙盘
// ============================================================================

function SandboxTab() {
  const cards = useAppStore(s => s.inspirationCards);
  const links = useAppStore(s => s.storyLinks);
  const createLink = useAppStore(s => s.createStoryLink);
  const deleteLink = useAppStore(s => s.deleteStoryLink);

  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [linking, setLinking] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const cardTitle = (id: string) => cards.find(c => c.id === id)?.title || '（已删除）';

  const targetOptions = useMemo(
    () => cards.filter(c => c.id !== sourceId),
    [cards, sourceId],
  );

  const handleCreate = async () => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setLinking(true);
    try {
      const link = await createLink(sourceId, targetId);
      if (link) {
        setLastLink(link.id);
        setSourceId('');
        setTargetId('');
      }
    } finally {
      setLinking(false);
    }
  };

  const handleDelete = (linkId: string, sourceTitle: string, targetTitle: string) => {
    if (!window.confirm(`确定删除「${sourceTitle} → ${targetTitle}」的叙事脉络？`)) return;
    deleteLink(linkId);
    if (lastLink === linkId) setLastLink(null);
  };

  return (
    <div className="space-y-2">
      {/* 已建立的连线 */}
      <div className="text-[11px] text-ink-400 flex items-center gap-1">
        <Link2 className="w-3 h-3" />
        已建立的叙事脉络（{links.length}）
      </div>

      {links.length === 0 ? (
        <div className="p-4 text-center">
          <Link2 className="w-7 h-7 text-ink-600 mx-auto mb-1.5" />
          <p className="text-[11px] text-ink-500">还没有连线，在下方选择两张卡片建立叙事脉络</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {links.map(link => {
            const isLast = lastLink === link.id;
            return (
              <div
                key={link.id}
                className={`group p-2 rounded border ${
                  isLast ? 'bg-amber-400/5 border-amber-500/30' : 'bg-ink-800/30 border-ink-700/40'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[11px] text-ink-200 truncate">{cardTitle(link.sourceCardId)}</span>
                  <span className="text-amber-400">→</span>
                  <span className="text-[11px] text-ink-200 truncate">{cardTitle(link.targetCardId)}</span>
                  <button
                    onClick={() => handleDelete(link.id, cardTitle(link.sourceCardId), cardTitle(link.targetCardId))}
                    className="ml-auto text-ink-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                    title="删除连线"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-[11px] text-ink-300 leading-relaxed">{link.narrative}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* 新建连线 */}
      <div className="p-2.5 bg-ink-800/40 border border-ink-700/50 rounded-lg space-y-2">
        <div className="text-[11px] text-amber-300 flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          新建叙事脉络
        </div>
        {cards.length < 2 ? (
          <p className="text-[10px] text-ink-500">至少需要两张灵感卡才能建立连线</p>
        ) : (
          <>
            <div>
              <label className="text-[10px] text-ink-500 block mb-0.5">源卡片</label>
              <select
                aria-label="源卡片"
                value={sourceId}
                onChange={e => setSourceId(e.target.value)}
                className="input text-[11px] py-1 w-full"
              >
                <option value="">选择源卡片…</option>
                {cards.map(c => (
                  <option key={c.id} value={c.id}>[{CARD_TYPE_LABELS[c.type]}] {c.title || '（无标题）'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-ink-500 block mb-0.5">目标卡片</label>
              <select
                aria-label="目标卡片"
                value={targetId}
                onChange={e => setTargetId(e.target.value)}
                className="input text-[11px] py-1 w-full"
              >
                <option value="">选择目标卡片…</option>
                {targetOptions.map(c => (
                  <option key={c.id} value={c.id}>[{CARD_TYPE_LABELS[c.type]}] {c.title || '（无标题）'}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={linking || !sourceId || !targetId || sourceId === targetId}
              className="w-full px-2 py-1 text-[11px] bg-amber-400/20 text-amber-200 hover:bg-amber-400/30 rounded flex items-center justify-center gap-1 disabled:opacity-40"
            >
              {linking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
              {linking ? '生成中…' : '建立关联'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 工具
// ============================================================================

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return '';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
