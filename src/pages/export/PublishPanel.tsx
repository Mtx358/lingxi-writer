import { Sparkles, Shield, Loader2, Tag, X, Check } from 'lucide-react';
import { PLATFORMS, SENSITIVITY_STYLE } from './constants';
import type { ExportPlatform, Project, PlatformTagRecommendation, SensitiveWordCheckResult } from '@/types';

interface PublishPanelProps {
  project: Project;
  platform: ExportPlatform;
  synopsisOptimizing: boolean;
  optimizedSynopsis: string | null;
  onOptimizedSynopsisChange: (value: string | null) => void;
  onOptimizeSynopsis: () => void;
  onApplyOptimizedSynopsis: () => void;
  tagRecommending: boolean;
  tagRecommendation: PlatformTagRecommendation | null;
  onTagRecommendationChange: (value: PlatformTagRecommendation | null) => void;
  onRecommendTags: () => void;
  onApplyRecommendedTags: () => void;
  scanningSensitive: boolean;
  onScanSensitiveWords: () => void;
  onClearSensitiveWordCheck: () => void;
  sensitiveResult: SensitiveWordCheckResult | null;
  sensitiveHitsBySeverity: { high: number; medium: number; low: number };
}

export function PublishPanel(props: PublishPanelProps) {
  const {
    project,
    platform,
    synopsisOptimizing,
    optimizedSynopsis,
    onOptimizedSynopsisChange,
    onOptimizeSynopsis,
    onApplyOptimizedSynopsis,
    tagRecommending,
    tagRecommendation,
    onTagRecommendationChange,
    onRecommendTags,
    onApplyRecommendedTags,
    scanningSensitive,
    onScanSensitiveWords,
    onClearSensitiveWordCheck,
    sensitiveResult,
    sensitiveHitsBySeverity,
  } = props;

  return (
    <>
      {/* 灵犀发布：简介优化 + 标签推荐 */}
      <section className="mb-6">
        <h2 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          上架素材优化
        </h2>
        <div className="card p-4 space-y-4">
          {/* 简介优化 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-ink-300">作品简介</span>
              <button
                onClick={onOptimizeSynopsis}
                disabled={synopsisOptimizing}
                className="px-2 py-1 text-[11px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                {synopsisOptimizing ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />优化中</>
                ) : (
                  <><Sparkles className="w-3 h-3" />按 {PLATFORMS.find(p => p.id === platform)?.label} 风格优化</>
                )}
              </button>
            </div>
            <textarea
              value={optimizedSynopsis ?? project.description ?? ''}
              onChange={(e) => {
                if (optimizedSynopsis) onOptimizedSynopsisChange(e.target.value);
              }}
              readOnly={!optimizedSynopsis}
              rows={4}
              placeholder={optimizedSynopsis ? '' : '当前无简介。点击"优化"让 AI 根据所选平台风格生成推荐简介'}
              className={`w-full px-2 py-1.5 text-xs bg-ink-700/50 text-ink-200 border border-ink-600/50 rounded focus:outline-none focus:border-amber-400/50 resize-none writing-font ${
                optimizedSynopsis ? 'border-amber-400/40' : ''
              }`}
            />
            {optimizedSynopsis && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={onApplyOptimizedSynopsis}
                  className="flex-1 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center justify-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />采纳并保存
                </button>
                <button
                  onClick={() => onOptimizedSynopsisChange(null)}
                  className="flex-1 py-1.5 text-xs bg-ink-700/50 text-ink-400 hover:bg-ink-700 rounded flex items-center justify-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />放弃
                </button>
              </div>
            )}
          </div>

          <div className="divider" />

          {/* 标签推荐 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-ink-300">平台标签与分类</span>
              <button
                onClick={onRecommendTags}
                disabled={tagRecommending}
                className="px-2 py-1 text-[11px] bg-ink-700/50 text-ink-300 hover:bg-ink-700 rounded transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                {tagRecommending ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />推荐中</>
                ) : (
                  <><Tag className="w-3 h-3" />AI 推荐标签</>
                )}
              </button>
            </div>
            {tagRecommendation ? (
              <div className="space-y-2">
                <div>
                  <div className="text-[10px] text-ink-500 mb-1">推荐标签</div>
                  <div className="flex flex-wrap gap-1">
                    {tagRecommendation.tags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 text-[11px] bg-amber-400/10 text-amber-300 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                {tagRecommendation.categories.length > 0 && (
                  <div>
                    <div className="text-[10px] text-ink-500 mb-1">推荐分类</div>
                    <div className="flex flex-wrap gap-1">
                      {tagRecommendation.categories.map(cat => (
                        <span key={cat} className="px-2 py-0.5 text-[11px] bg-blue-400/10 text-blue-300 rounded">
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {tagRecommendation.reason && (
                  <div className="text-[11px] text-ink-500 italic">推荐理由：{tagRecommendation.reason}</div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={onApplyRecommendedTags}
                    className="flex-1 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center justify-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />合并到设定卡
                  </button>
                  <button
                    onClick={() => onTagRecommendationChange(null)}
                    className="flex-1 py-1.5 text-xs bg-ink-700/50 text-ink-400 hover:bg-ink-700 rounded flex items-center justify-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" />关闭
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-ink-500">
                基于设定卡（题材/情感基调/感情线）与简介，AI 推荐适合该平台的标签与分类。
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 灵犀发布：敏感词扫描 */}
      <section className="mb-6">
        <h2 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-amber-400" />
          敏感词扫描
        </h2>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-ink-500">
              本地词库扫描全书章节正文，不发送任何内容到云端
            </span>
            <div className="flex gap-2">
              {sensitiveResult && (
                <button
                  onClick={onClearSensitiveWordCheck}
                  className="px-2 py-1 text-[11px] bg-ink-700/50 text-ink-400 hover:bg-ink-700 rounded"
                >
                  清空结果
                </button>
              )}
              <button
                onClick={onScanSensitiveWords}
                disabled={scanningSensitive}
                className="px-3 py-1 text-[11px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                {scanningSensitive ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />扫描中</>
                ) : (
                  <><Shield className="w-3 h-3" />扫描全书</>
                )}
              </button>
            </div>
          </div>
          {sensitiveResult ? (
            sensitiveResult.totalHits === 0 ? (
              <div className="flex items-start gap-2 p-2 rounded text-xs bg-emerald-400/10 text-emerald-300">
                <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>未发现敏感词，全书章节已通过本地词库扫描</span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-red-300 font-medium">命中 {sensitiveResult.totalHits} 处</span>
                  <span className="text-ink-500">·</span>
                  <span className="text-ink-400">
                    高风险 {sensitiveHitsBySeverity.high} ·
                    中风险 {sensitiveHitsBySeverity.medium} ·
                    低风险 {sensitiveHitsBySeverity.low}
                  </span>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1.5">
                  {sensitiveResult.hits.map((hit, idx) => (
                    <div key={idx} className={`p-2 rounded border text-[11px] ${SENSITIVITY_STYLE[hit.severity]}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">「{hit.word}」</span>
                        <span className="text-[10px] opacity-70">{hit.chapterTitle} · 第 {hit.paragraphIndex + 1} 段 · {hit.severity}</span>
                      </div>
                      <div className="opacity-80 leading-relaxed">…{hit.context}…</div>
                      {hit.suggestion && (
                        <div className="mt-1 text-[10px] opacity-70">建议：{hit.suggestion}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <p className="text-[11px] text-ink-500 text-center py-4">
              点击"扫描全书"开始检查敏感词
            </p>
          )}
        </div>
      </section>
    </>
  );
}
