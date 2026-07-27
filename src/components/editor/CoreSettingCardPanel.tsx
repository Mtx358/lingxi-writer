/**
 * 灵犀设定 - 核心设定卡面板（灵犀助手 1.1）
 *
 * 把零碎想法结构化为统一卡片：书名/类型标签/卖点/预计字数/主角/世界观/核心冲突/情感基调/感情线。
 * 集成 AI 实时提问深化（askSettingCardQuestions）与矛盾点检查（checkSettingCard）。
 *
 * 与现有 CharactersPanel / SettingsPanel 的关系：
 *   - 本面板是"高层设定"（决定整本书走向的字段）
 *   - CharactersPanel 是"角色谱系"（每个角色一张卡，可拖拽连线）
 *   - SettingsPanel 是"世界设定项"（key-value 形式的细化设定）
 * 三者互补：核心设定卡 → 角色/设定细化 → 写作时引用
 */
import { useState, useId } from 'react';
import { Sparkles, AlertTriangle, CheckCircle, Loader2, Plus, X, HelpCircle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import {
  EMOTIONAL_TONE_LABELS,
  EMOTIONAL_TONES,
  ROMANCE_TYPE_LABELS,
  ROMANCE_TYPES,
  type EmotionalTone,
  type RomanceType,
  type ProjectSettingCard,
} from '@/types';
import Empty from '@/components/Empty';
import Field from '@/components/Field';

const COMMON_GENRES = ['都市', '玄幻', '悬疑', '系统', '穿越', '重生', '历史', '科幻', '言情', '武侠', '仙侠', '游戏', '末世', '奇幻'];

export default function CoreSettingCardPanel() {
  const card = useAppStore(s => s.projects.find(p => p.id === s.currentProjectId)?.settingCard || null);
  const initSettingCard = useAppStore(s => s.initSettingCard);
  const updateSettingCard = useAppStore(s => s.updateSettingCard);
  const askSettingCardQuestions = useAppStore(s => s.askSettingCardQuestions);
  const checkSettingCard = useAppStore(s => s.checkSettingCard);
  const resolveSettingCardContradiction = useAppStore(s => s.resolveSettingCardContradiction);
  const isSettingCardBusy = useAppStore(s => s.isSettingCardBusy);
  const settingCardQuestions = useAppStore(s => s.settingCardQuestions);

  const [genreInput, setGenreInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  // 类型标签 / 性格关键词 Field 的 children 为多元素，无法自动注入 id，
  // 这里生成唯一 id 显式关联 label 与其中的文本输入框
  const genreInputId = useId();
  const keywordInputId = useId();

  if (!card) {
    return (
      <Empty
        icon={<Sparkles className="w-10 h-10 text-amber-400" aria-hidden="true" />}
        title="还没有核心设定卡"
        description="把零碎想法结构化，让 AI 帮你深化每个细节。核心设定卡是后续蓝图与正文创作的基石。"
        action={
          <button
            onClick={() => initSettingCard()}
            className="btn btn-primary flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            初始化核心设定卡
          </button>
        }
        className="p-6 gap-4"
      />
    );
  }

  const handleAddGenre = () => {
    const g = genreInput.trim();
    if (!g || card.genreTags.includes(g)) return;
    updateSettingCard({ genreTags: [...card.genreTags, g] });
    setGenreInput('');
  };

  const handleRemoveGenre = (g: string) => {
    updateSettingCard({ genreTags: card.genreTags.filter(x => x !== g) });
  };

  const handleAddKeyword = () => {
    const k = keywordInput.trim();
    if (!k || card.protagonist.personalityKeywords.includes(k)) return;
    updateSettingCard({
      protagonist: {
        ...card.protagonist,
        personalityKeywords: [...card.protagonist.personalityKeywords, k],
      },
    });
    setKeywordInput('');
  };

  const handleRemoveKeyword = (k: string) => {
    updateSettingCard({
      protagonist: {
        ...card.protagonist,
        personalityKeywords: card.protagonist.personalityKeywords.filter(x => x !== k),
      },
    });
  };

  const handleAsk = async () => {
    // 包 try/catch：askSettingCardQuestions 抛错时未复位 isSettingCardBusy，
    // "AI 提问"按钮会永久禁用；catch 中提示失败原因
    try {
      await askSettingCardQuestions();
    } catch (e) {
      toast.error('AI 提问失败', getErrorMessage(e));
    }
  };

  const handleCheck = async () => {
    // 包 try/catch：checkSettingCard 抛错时未复位 isSettingCardBusy，
    // "矛盾检查"按钮会永久禁用；catch 中提示失败原因
    try {
      await checkSettingCard();
    } catch (e) {
      toast.error('矛盾检查失败', getErrorMessage(e));
    }
  };

  return (
    <div className="p-4 space-y-5 text-sm">
      {/* 顶部行动区 */}
      <div className="flex items-center gap-2 pb-3 border-b border-ink-700/50">
        <Sparkles className="w-4 h-4 text-amber-400" aria-hidden="true" />
        <h2 className="font-medium text-ink-100 flex-1">核心设定卡</h2>
        <button
          onClick={handleAsk}
          disabled={isSettingCardBusy}
          className="btn btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
          title="AI 基于当前设定卡提出深化问题"
        >
          {isSettingCardBusy ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <HelpCircle className="w-3 h-3" aria-hidden="true" />}
          AI 提问
        </button>
        <button
          onClick={handleCheck}
          disabled={isSettingCardBusy}
          className="btn btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
          title="检查设定卡是否存在矛盾"
        >
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
          矛盾检查
        </button>
      </div>

      {/* 基础字段 */}
      <section className="space-y-3">
        <Field label="书名">
          <input
            type="text"
            value={card.title}
            onChange={e => updateSettingCard({ title: e.target.value })}
            placeholder="暂定即可"
            className="input-field"
          />
        </Field>

        <Field label="类型标签" inputId={genreInputId}>
          <div className="flex flex-wrap gap-1 mb-2">
            {card.genreTags.map(g => (
              <span
                key={g}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-400/15 text-amber-300 rounded text-xs"
              >
                {g}
                <button
                  onClick={() => handleRemoveGenre(g)}
                  className="hover:text-amber-200"
                  aria-label={`移除标签 ${g}`}
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              id={genreInputId}
              type="text"
              value={genreInput}
              onChange={e => setGenreInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddGenre(); } }}
              placeholder="自定义标签"
              className="input-field text-xs"
            />
            <button onClick={handleAddGenre} className="btn btn-secondary text-xs px-2" aria-label="添加标签">
              <Plus className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {COMMON_GENRES.filter(g => !card.genreTags.includes(g)).slice(0, 6).map(g => (
              <button
                key={g}
                onClick={() => updateSettingCard({ genreTags: [...card.genreTags, g] })}
                className="px-2 py-0.5 bg-ink-800 hover:bg-ink-700 text-ink-400 hover:text-ink-200 rounded text-xs transition-colors"
              >
                + {g}
              </button>
            ))}
          </div>
        </Field>

        <Field label="一句话卖点">
          <textarea
            value={card.sellingPoint || ''}
            onChange={e => updateSettingCard({ sellingPoint: e.target.value })}
            placeholder="让读者一眼产生兴趣的卖点"
            rows={2}
            className="input-field resize-none"
          />
        </Field>

        <Field label="预计总字数（万字）">
          <input
            type="number"
            value={card.estimatedTotalWords ?? ''}
            onChange={e => updateSettingCard({ estimatedTotalWords: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="如 100、200、300"
            className="input-field"
          />
        </Field>
      </section>

      {/* 主角卡 */}
      <section className="space-y-3 pt-3 border-t border-ink-700/50">
        <h3 className="text-xs uppercase tracking-wider text-ink-400">主角</h3>
        <div className="grid grid-cols-2 gap-2">
          <Field label="姓名">
            <input
              type="text"
              value={card.protagonist.name}
              onChange={e => updateSettingCard({ protagonist: { ...card.protagonist, name: e.target.value } })}
              className="input-field"
            />
          </Field>
          <Field label="年龄">
            <input
              type="text"
              value={card.protagonist.age || ''}
              onChange={e => updateSettingCard({ protagonist: { ...card.protagonist, age: e.target.value } })}
              className="input-field"
            />
          </Field>
        </div>
        <Field label="初始身份">
          <input
            type="text"
            value={card.protagonist.initialIdentity || ''}
            onChange={e => updateSettingCard({ protagonist: { ...card.protagonist, initialIdentity: e.target.value } })}
            placeholder="如：高三学生 / 落魄程序员"
            className="input-field"
          />
        </Field>
        <Field label="性格关键词（3-5 个）" inputId={keywordInputId}>
          <div className="flex flex-wrap gap-1 mb-2">
            {card.protagonist.personalityKeywords.map(k => (
              <span
                key={k}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-400/15 text-blue-300 rounded text-xs"
              >
                {k}
                <button
                  onClick={() => handleRemoveKeyword(k)}
                  className="hover:text-blue-200"
                  aria-label={`移除关键词 ${k}`}
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              id={keywordInputId}
              type="text"
              value={keywordInput}
              onChange={e => setKeywordInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddKeyword(); } }}
              placeholder="如：冷静、执着、有点腹黑"
              className="input-field text-xs"
            />
            <button onClick={handleAddKeyword} className="btn btn-secondary text-xs px-2" aria-label="添加关键词">
              <Plus className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
        </Field>
        <Field label="核心欲望（他想要什么）">
          <textarea
            value={card.protagonist.coreDesire || ''}
            onChange={e => updateSettingCard({ protagonist: { ...card.protagonist, coreDesire: e.target.value } })}
            rows={2}
            className="input-field resize-none"
          />
        </Field>
        <Field label="致命弱点（什么会阻碍他）">
          <textarea
            value={card.protagonist.fatalFlaw || ''}
            onChange={e => updateSettingCard({ protagonist: { ...card.protagonist, fatalFlaw: e.target.value } })}
            rows={2}
            className="input-field resize-none"
          />
        </Field>
        <Field label="金手指/特殊能力">
          <textarea
            value={card.protagonist.goldenFinger || ''}
            onChange={e => updateSettingCard({ protagonist: { ...card.protagonist, goldenFinger: e.target.value } })}
            placeholder="如有代价或限制，请说明"
            rows={2}
            className="input-field resize-none"
          />
        </Field>
        <Field label="成长主线（从什么变成什么）">
          <textarea
            value={card.protagonist.growthArc || ''}
            onChange={e => updateSettingCard({ protagonist: { ...card.protagonist, growthArc: e.target.value } })}
            placeholder="如：从被动接受命运到主动塑造命运"
            rows={2}
            className="input-field resize-none"
          />
        </Field>
      </section>

      {/* 世界观 */}
      <section className="space-y-3 pt-3 border-t border-ink-700/50">
        <h3 className="text-xs uppercase tracking-wider text-ink-400">世界观</h3>
        <Field label="世界基本规则">
          <textarea
            value={card.worldview.basicRules || ''}
            onChange={e => updateSettingCard({ worldview: { ...card.worldview, basicRules: e.target.value } })}
            rows={2}
            className="input-field resize-none"
          />
        </Field>
        <Field label="力量体系/等级划分">
          <textarea
            value={card.worldview.powerSystem || ''}
            onChange={e => updateSettingCard({ worldview: { ...card.worldview, powerSystem: e.target.value } })}
            rows={2}
            className="input-field resize-none"
          />
        </Field>
        <Field label="势力格局">
          <textarea
            value={card.worldview.factionLandscape || ''}
            onChange={e => updateSettingCard({ worldview: { ...card.worldview, factionLandscape: e.target.value } })}
            rows={2}
            className="input-field resize-none"
          />
        </Field>
        <Field label="关键历史事件">
          <textarea
            value={card.worldview.keyHistory || ''}
            onChange={e => updateSettingCard({ worldview: { ...card.worldview, keyHistory: e.target.value } })}
            rows={2}
            className="input-field resize-none"
          />
        </Field>
      </section>

      {/* 核心冲突 */}
      <section className="space-y-3 pt-3 border-t border-ink-700/50">
        <h3 className="text-xs uppercase tracking-wider text-ink-400">核心冲突</h3>
        <Field label="主线冲突">
          <textarea
            value={card.coreConflict.mainConflict || ''}
            onChange={e => updateSettingCard({ coreConflict: { ...card.coreConflict, mainConflict: e.target.value } })}
            rows={2}
            className="input-field resize-none"
          />
        </Field>
        <Field label="主要反派/阻力">
          <textarea
            value={card.coreConflict.mainAntagonist || ''}
            onChange={e => updateSettingCard({ coreConflict: { ...card.coreConflict, mainAntagonist: e.target.value } })}
            rows={2}
            className="input-field resize-none"
          />
        </Field>
        <Field label="终极目标">
          <textarea
            value={card.coreConflict.ultimateGoal || ''}
            onChange={e => updateSettingCard({ coreConflict: { ...card.coreConflict, ultimateGoal: e.target.value } })}
            rows={2}
            className="input-field resize-none"
          />
        </Field>
      </section>

      {/* 情感基调 & 感情线 */}
      <section className="space-y-3 pt-3 border-t border-ink-700/50">
        <h3 className="text-xs uppercase tracking-wider text-ink-400">基调</h3>
        <Field label="情感基调">
          <div className="flex flex-wrap gap-1">
            {EMOTIONAL_TONES.map(t => (
              <button
                key={t}
                onClick={() => updateSettingCard({ emotionalTone: t as EmotionalTone })}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  card.emotionalTone === t
                    ? 'bg-amber-400 text-ink-900'
                    : 'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200'
                }`}
              >
                {EMOTIONAL_TONE_LABELS[t]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="感情线">
          <div className="flex flex-wrap gap-1">
            {ROMANCE_TYPES.map(t => (
              <button
                key={t}
                onClick={() => updateSettingCard({ romanceType: t as RomanceType })}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  card.romanceType === t
                    ? 'bg-amber-400 text-ink-900'
                    : 'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200'
                }`}
              >
                {ROMANCE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </Field>
      </section>

      {/* AI 提问结果 */}
      {settingCardQuestions.length > 0 && (
        <section className="space-y-2 pt-3 border-t border-ink-700/50">
          <div className="flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
            <h3 className="text-xs uppercase tracking-wider text-ink-400">AI 深化提问</h3>
          </div>
          <ul className="space-y-2">
            {settingCardQuestions.map((q, i) => (
              <li key={i} className="p-2 bg-ink-800/50 rounded text-xs text-ink-300 leading-relaxed">
                {i + 1}. {q}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-ink-500">回答这些问题后，把答案填回对应字段</p>
        </section>
      )}

      {/* 矛盾点检查结果 */}
      {card.contradictions && card.contradictions.length > 0 && (
        <section className="space-y-2 pt-3 border-t border-ink-700/50">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />
            <h3 className="text-xs uppercase tracking-wider text-ink-400">矛盾点（{card.contradictions.length}）</h3>
          </div>
          <ul className="space-y-2">
            {card.contradictions.map((c, i) => (
              <li
                key={i}
                className={`p-2 rounded text-xs leading-relaxed flex items-start gap-2 ${
                  c.resolved ? 'bg-emerald-500/10 text-ink-500' :
                  c.severity === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className={`px-1 rounded text-[10px] ${
                      c.severity === 'error' ? 'bg-red-500/20' : 'bg-amber-500/20'
                    }`}>
                      {c.severity === 'error' ? '错误' : '警告'}
                    </span>
                    {c.resolved && (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                        <CheckCircle className="w-3 h-3" aria-hidden="true" /> 已处理
                      </span>
                    )}
                  </div>
                  {c.description}
                </div>
                {!c.resolved && (
                  <button
                    onClick={() => resolveSettingCardContradiction(i)}
                    className="text-[10px] text-ink-400 hover:text-ink-200 underline whitespace-nowrap"
                  >
                    标记已解决
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// 重新导出类型供外部使用
export type { ProjectSettingCard };
