import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, X, SkipForward } from 'lucide-react';

export interface TourStep {
  selector: string;
  title: string;
  description: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

interface InteractiveTourProps {
  steps: TourStep[];
  onComplete: () => void;
  onSkip: () => void;
}

const HIGHLIGHT_PADDING = 6;
const TOOLTIP_GAP = 14;
const TOOLTIP_WIDTH = 320;
const ESTIMATED_TOOLTIP_HEIGHT = 190;

type TargetRect = { top: number; left: number; width: number; height: number };

export default function InteractiveTour({ steps, onComplete, onSkip }: InteractiveTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [resolvedIndex, setResolvedIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const [arrowStyle, setArrowStyle] = useState<React.CSSProperties>({ display: 'none' });
  const completedRef = useRef(false);

  const resolveAndLayout = useCallback(() => {
    if (steps.length === 0) {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
      return;
    }

    let idx = currentStep;
    let foundEl: HTMLElement | null = null;
    let foundRect: DOMRect | null = null;

    for (; idx < steps.length; idx++) {
      const el = document.querySelector(steps[idx].selector) as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      if (el && r && r.width > 0 && r.height > 0) {
        foundEl = el;
        foundRect = r;
        break;
      }
    }

    if (!foundEl || !foundRect) {
      setTargetRect(null);
      setTooltipPos(null);
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
      return;
    }

    const resolvedStep = steps[idx];
    const place = resolvedStep.placement ?? 'bottom';
    const tr: TargetRect = {
      top: foundRect.top,
      left: foundRect.left,
      width: foundRect.width,
      height: foundRect.height,
    };
    setTargetRect(tr);
    setResolvedIndex(idx);

    const right = tr.left + tr.width;
    const bottom = tr.top + tr.height;
    const centerX = tr.left + tr.width / 2;
    const centerY = tr.top + tr.height / 2;

    let top: number;
    let left: number;
    let arrow: React.CSSProperties;

    switch (place) {
      case 'top':
        top = tr.top - ESTIMATED_TOOLTIP_HEIGHT - TOOLTIP_GAP;
        left = centerX - TOOLTIP_WIDTH / 2;
        arrow = { bottom: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)' };
        break;
      case 'left':
        top = centerY - ESTIMATED_TOOLTIP_HEIGHT / 2;
        left = tr.left - TOOLTIP_WIDTH - TOOLTIP_GAP;
        arrow = { right: -5, top: '50%', transform: 'translateY(-50%) rotate(45deg)' };
        break;
      case 'right':
        top = centerY - ESTIMATED_TOOLTIP_HEIGHT / 2;
        left = right + TOOLTIP_GAP;
        arrow = { left: -5, top: '50%', transform: 'translateY(-50%) rotate(45deg)' };
        break;
      case 'bottom':
      default:
        top = bottom + TOOLTIP_GAP;
        left = centerX - TOOLTIP_WIDTH / 2;
        arrow = { top: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)' };
        break;
    }

    left = Math.max(12, Math.min(left, window.innerWidth - TOOLTIP_WIDTH - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - ESTIMATED_TOOLTIP_HEIGHT - 12));

    setTooltipPos({ top, left });
    setArrowStyle(arrow);
  }, [currentStep, steps, onComplete]);

  useLayoutEffect(() => {
    resolveAndLayout();
  }, [resolveAndLayout]);

  useEffect(() => {
    const handler = () => resolveAndLayout();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [resolveAndLayout]);

  const handleNext = () => {
    if (resolvedIndex >= steps.length - 1) {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
      return;
    }
    setCurrentStep(resolvedIndex + 1);
  };

  const handlePrev = () => {
    if (resolvedIndex === 0) return;
    setCurrentStep(Math.max(0, resolvedIndex - 1));
  };

  const handleSkip = () => {
    if (!completedRef.current) {
      completedRef.current = true;
      onSkip();
    }
  };

  const resolvedStep = steps[resolvedIndex];
  if (!resolvedStep) return null;

  const isFirst = resolvedIndex === 0;
  const isLast = resolvedIndex === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[200]">
      {/* Highlight hole with dimming overlay via box-shadow */}
      {targetRect && (
        <div
          className="absolute rounded-lg transition-all duration-300 ease-out"
          style={{
            top: targetRect.top - HIGHLIGHT_PADDING,
            left: targetRect.left - HIGHLIGHT_PADDING,
            width: targetRect.width + HIGHLIGHT_PADDING * 2,
            height: targetRect.height + HIGHLIGHT_PADDING * 2,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.72)',
            border: '2px solid rgba(245, 158, 11, 0.6)',
          }}
        />
      )}

      {/* Tooltip bubble */}
      {tooltipPos && (
        <div
          className="absolute animate-slide-up"
          style={{ top: tooltipPos.top, left: tooltipPos.left, width: TOOLTIP_WIDTH }}
        >
          {/* Arrow pointing toward the target */}
          <div
            className="absolute w-2.5 h-2.5 bg-ink-900 border border-amber-400/50"
            style={arrowStyle}
          />

          <div className="relative bg-ink-900 border border-amber-400/50 rounded-xl shadow-large p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="text-sm font-semibold text-amber-300">{resolvedStep.title}</h3>
              <button
                onClick={handleSkip}
                className="p-0.5 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
                title="跳过引导"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-xs text-ink-400 leading-relaxed mb-3">{resolvedStep.description}</p>

            {/* Progress */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] text-ink-600">
                {resolvedIndex + 1} / {steps.length}
              </span>
              <div className="flex gap-1">
                {steps.map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-1 rounded-full transition-all duration-300 ${
                      idx === resolvedIndex
                        ? 'w-4 bg-amber-400'
                        : idx < resolvedIndex
                        ? 'w-1.5 bg-amber-400/60'
                        : 'w-1.5 bg-ink-700'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {!isFirst && (
                <button onClick={handlePrev} className="btn btn-secondary flex-1 text-xs py-1.5">
                  <ChevronLeft className="w-3.5 h-3.5" />
                  上一步
                </button>
              )}
              <button onClick={handleNext} className="btn btn-primary flex-1 text-xs py-1.5">
                {isLast ? (
                  '完成'
                ) : (
                  <>
                    下一步
                    <ChevronRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>

            {!isLast && (
              <button
                onClick={handleSkip}
                className="w-full mt-2 text-[10px] text-ink-600 hover:text-ink-400 transition-colors flex items-center justify-center gap-1"
              >
                <SkipForward className="w-3 h-3" />
                跳过引导
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
