/**
 * 灵犀总控 - 存稿与更新管理面板（灵犀助手 6.5）
 *
 * 提供存稿余量统计、日更速度配置、断更预警与上架建议：
 *   - 存稿余量（天）：getStockpileDays() = 已写正文章节字数 ÷ 日更速度
 *   - 已写总字数 / 已写章节数：从 chapters 中按 levelType === 'chapter' 聚合
 *   - 断更预警：lastUpdateAt 距今超过 staleAlertDays 时红色提示，否则绿色显示上次更新距今
 *   - 上架建议：当前章节数与 paywallChapterThreshold 对比，给出进度条或达成提示
 *   - 手动标记今日已更新：写入 lastUpdateAt = now
 *
 * 仅依赖灵犀 slice 与 chapter slice 已有接口，不新增任何依赖。
 */
import { useMemo, useId } from 'react';
import { Calendar, Clock, AlertTriangle, CheckCircle, TrendingUp, BookOpen, Zap } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { formatDate } from '@/utils/storage';
import type { UpdateSchedule } from '@/types';
import Empty from '@/components/Empty';

/** 数值字段联合类型，用于统一处理 number input 的变更 */
type NumericScheduleField = 'dailyTargetWords' | 'dailySpeed' | 'paywallChapterThreshold' | 'staleAlertDays';

/** 一天的毫秒数，用于计算距上次更新的天数 */
const MS_PER_DAY = 86400000;

export default function UpdateSchedulePanel() {
  const schedule = useAppStore(s => s.updateSchedule);
  const updateUpdateSchedule = useAppStore(s => s.updateUpdateSchedule);
  const getStockpileDays = useAppStore(s => s.getStockpileDays);
  const chapters = useAppStore(s => s.chapters);
  const uid = useId();

  // ===== 派生统计 =====
  // 用 useMemo 缓存：getStockpileDays 内部会全量扫描 chapters，每次渲染都调用
  // 会在大项目下造成可感知卡顿。所有 hooks 必须在 early return 之前调用，
  // schedule 为空时取 0 兜底，结果不会被渲染（空状态分支直接 return）。
  // chapters 是必要依赖：getStockpileDays 通过 store getter 间接读取 chapters，
  // 但 ESLint 静态分析无法看到闭包内的读取，需要显式声明。
  // 通过 void chapters 显式引用，让 exhaustive-deps 识别为已使用依赖
  const stockpileDays = useMemo(() => {
    void chapters; // 显式声明依赖：getStockpileDays 内部读取 chapters
    return schedule ? getStockpileDays() : 0;
  }, [getStockpileDays, chapters, schedule]);
  const chapterList = useMemo(() => chapters.filter(c => c.levelType === 'chapter'), [chapters]);
  const totalWords = useMemo(() => chapterList.reduce((sum, c) => sum + (c.wordCount || 0), 0), [chapterList]);
  const chapterCount = chapterList.length;

  // 空状态：updateUpdateSchedule({}) 会以 createDefaultUpdateSchedule 兜底创建默认配置
  if (!schedule) {
    return (
      <div className="p-6 flex flex-col items-center gap-4">
        <div className="text-center">
          <Calendar className="w-10 h-10 text-amber-400 mx-auto mb-2" aria-hidden="true" />
          <h3 className="text-base font-medium text-ink-200 mb-1">尚未配置存稿与更新管理</h3>
          <p className="text-xs text-ink-500 max-w-xs">
            初始化后可统计存稿余量、配置日更速度、开启断更预警并获得上架建议。
          </p>
        </div>
        <button
          onClick={() => updateUpdateSchedule({})}
          className="btn btn-primary flex items-center gap-2"
        >
          <Calendar className="w-4 h-4" aria-hidden="true" />
          点击初始化
        </button>
      </div>
    );
  }

  // 距上次更新的天数（lastUpdateAt 为空时为 null；时钟偏差钳到 0）
  const daysSinceUpdate = schedule.lastUpdateAt
    ? Math.max(0, Math.floor((Date.now() - new Date(schedule.lastUpdateAt).getTime()) / MS_PER_DAY))
    : null;
  // 断更判定：开启预警且距今 >= 阈值
  const isStale = schedule.enableStaleAlert
    && daysSinceUpdate !== null
    && daysSinceUpdate >= schedule.staleAlertDays;

  // 上架建议进度：threshold=0 视为"未设置"，不显示已达成提示
  const paywallThresholdValid = schedule.paywallChapterThreshold > 0;
  const paywallReached = paywallThresholdValid && chapterCount >= schedule.paywallChapterThreshold;
  const chaptersToPaywall = Math.max(0, schedule.paywallChapterThreshold - chapterCount);
  const paywallProgress = paywallThresholdValid
    ? Math.min(100, Math.round((chapterCount / schedule.paywallChapterThreshold) * 100))
    : 0;

  // 统一处理数值字段变更：用 Number 解析避免 parseInt 静默截断小数（如 '1.5' → 1）
  // 空串/非法值回退为 0，并钳到非负
  const handleNumericChange = (field: NumericScheduleField, raw: string) => {
    const parsed = Number(raw);
    const num = Number.isFinite(parsed) ? Math.floor(parsed) : 0;
    const value = Math.max(0, num);
    updateUpdateSchedule({ [field]: value } as Partial<UpdateSchedule>);
  };

  const handleToggleStaleAlert = () => {
    updateUpdateSchedule({ enableStaleAlert: !schedule.enableStaleAlert });
  };

  const handleMarkUpdated = () => {
    updateUpdateSchedule({ lastUpdateAt: new Date().toISOString() });
  };

  return (
    <div className="p-4 space-y-5 text-sm">
      {/* 顶部标题 */}
      <div className="flex items-center gap-2 pb-3 border-b border-ink-700/50">
        <Calendar className="w-4 h-4 text-amber-400" aria-hidden="true" />
        <h2 className="font-medium text-ink-100 flex-1">存稿与更新管理</h2>
      </div>

      {/* 统计卡片栏 */}
      <div className="grid grid-cols-3 gap-3">
        {/* 存稿余量 */}
        <div className="card p-3 text-center">
          <div className="flex items-baseline justify-center gap-1 text-amber-300">
            <span className="text-2xl font-semibold">{stockpileDays}</span>
            <span className="text-xs text-ink-400">天</span>
          </div>
          <div className="text-xs text-ink-300 mt-1">存稿余量</div>
          <div className="text-[10px] text-ink-500 mt-0.5">按当前字数 ÷ 日更速度</div>
        </div>
        {/* 已写总字数 */}
        <div className="card p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-amber-300">
            <BookOpen className="w-3 h-3 self-center" aria-hidden="true" />
            <span className="text-2xl font-semibold">{totalWords.toLocaleString()}</span>
          </div>
          <div className="text-xs text-ink-300 mt-1">已写总字数</div>
          <div className="text-[10px] text-ink-500 mt-0.5">仅统计正文章节</div>
        </div>
        {/* 已写章节数 */}
        <div className="card p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-amber-300">
            <TrendingUp className="w-3 h-3 self-center" aria-hidden="true" />
            <span className="text-2xl font-semibold">{chapterCount}</span>
          </div>
          <div className="text-xs text-ink-300 mt-1">已写章节数</div>
          <div className="text-[10px] text-ink-500 mt-0.5">正文章节计数</div>
        </div>
      </div>

      {/* 配置区 */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-ink-700/50">
          <Zap className="w-4 h-4 text-amber-400" aria-hidden="true" />
          <h3 className="font-medium text-ink-100">更新配置</h3>
        </div>

        {/* 日更目标字数 */}
        <div>
          <label htmlFor={`${uid}-daily-target`} className="block text-xs text-ink-400 mb-1">日更目标字数</label>
          <input
            id={`${uid}-daily-target`}
            type="number"
            min={0}
            value={schedule.dailyTargetWords}
            onChange={e => handleNumericChange('dailyTargetWords', e.target.value)}
            className="input-field"
          />
        </div>

        {/* 日更速度 */}
        <div>
          <label htmlFor={`${uid}-daily-speed`} className="block text-xs text-ink-400 mb-1">日更速度（字/天）</label>
          <input
            id={`${uid}-daily-speed`}
            type="number"
            min={0}
            value={schedule.dailySpeed}
            onChange={e => handleNumericChange('dailySpeed', e.target.value)}
            className="input-field"
          />
          <p className="text-[10px] text-ink-500 mt-1">用于估算存稿余量</p>
        </div>

        {/* 收费章节阈值 */}
        <div>
          <label htmlFor={`${uid}-paywall-threshold`} className="block text-xs text-ink-400 mb-1">收费章节阈值</label>
          <input
            id={`${uid}-paywall-threshold`}
            type="number"
            min={0}
            value={schedule.paywallChapterThreshold}
            onChange={e => handleNumericChange('paywallChapterThreshold', e.target.value)}
            className="input-field"
          />
          <p className="text-[10px] text-ink-500 mt-1">建议的上架节点</p>
        </div>

        {/* 断更预警开关 */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <div className="text-xs text-ink-300">断更预警</div>
            <div className="text-[10px] text-ink-500">超过阈值未更新时提醒</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={schedule.enableStaleAlert}
            aria-label="切换断更预警"
            onClick={handleToggleStaleAlert}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${schedule.enableStaleAlert ? 'bg-amber-400' : 'bg-ink-700'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${schedule.enableStaleAlert ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>

        {/* 断更预警阈值（仅在开启时显示） */}
        {schedule.enableStaleAlert && (
          <div>
            <label htmlFor={`${uid}-stale-days`} className="block text-xs text-ink-400 mb-1">断更预警阈值（天）</label>
            <input
              id={`${uid}-stale-days`}
              type="number"
              min={1}
              value={schedule.staleAlertDays}
              onChange={e => handleNumericChange('staleAlertDays', e.target.value)}
              className="input-field"
            />
          </div>
        )}
      </div>

      {/* 预警区：三态互斥显示 */}
      <div className="space-y-2">
        {isStale && daysSinceUpdate !== null && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>已断更 {daysSinceUpdate} 天，请尽快更新</span>
          </div>
        )}
        {!isStale && daysSinceUpdate !== null && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
            <CheckCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>上次更新：{daysSinceUpdate === 0 ? '今天' : `${daysSinceUpdate} 天前`}</span>
          </div>
        )}
        {daysSinceUpdate === null && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-ink-800/50 border border-ink-700/50 text-ink-400">
            <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>尚未记录更新时间</span>
          </div>
        )}
      </div>

      {/* 上架建议 */}
      <div className="card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-amber-400" aria-hidden="true" />
          <h3 className="font-medium text-ink-100">上架建议</h3>
        </div>
        {paywallReached ? (
          <div className="flex items-center gap-2 p-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
            <CheckCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>已达到上架建议节点（{schedule.paywallChapterThreshold} 章）</span>
          </div>
        ) : paywallThresholdValid ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-ink-400">
              <span>当前 {chapterCount} / {schedule.paywallChapterThreshold} 章</span>
              <span>距上架还差 {chaptersToPaywall} 章</span>
            </div>
            <div className="h-2 bg-ink-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all"
                style={{ width: `${paywallProgress}%` }}
              />
            </div>
          </div>
        ) : (
          <Empty title="尚未配置收费章节阈值，请先在上方设置。" className="text-xs text-ink-500 italic h-auto justify-start" />
        )}
      </div>

      {/* 手动操作 */}
      <div className="flex items-center justify-between gap-2">
        {schedule.lastUpdateAt ? (
          <div className="text-xs text-ink-500">
            上次标记：{formatDate(schedule.lastUpdateAt)}
          </div>
        ) : (
          <div className="text-xs text-ink-500" role="status" aria-live="polite">
            尚无更新记录
          </div>
        )}
        <button
          onClick={handleMarkUpdated}
          className="btn btn-primary flex items-center gap-2"
        >
          <CheckCircle className="w-4 h-4" aria-hidden="true" />
          标记今日已更新
        </button>
      </div>
    </div>
  );
}
