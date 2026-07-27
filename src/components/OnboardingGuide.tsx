import { useState, useEffect, useRef } from 'react';
import { Sparkles, ChevronRight, X, Check, AlertTriangle } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface GuideStep {
  id: string;
  title: string;
  description: string;
  icon: typeof Sparkles;
  highlight?: string;
}

interface OnboardingGuideProps {
  onComplete: () => void;
  onSkip: () => void;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    title: '欢迎来到灵犀写作助手',
    description: '一个以"人主导、AI 辅助"为核心理念的专业写作工具。进入编辑器后，还会有更详细的交互式功能引导。',
    icon: Sparkles,
  },
  {
    id: 'conflict',
    title: '冲突检测',
    description: 'AI 会自动检测角色名不一致、人称混乱、设定冲突等问题，帮你保持作品的一致性。',
    icon: AlertTriangle,
  },
  {
    id: 'done',
    title: '准备就绪！',
    description: '现在你已经了解了核心理念，开始你的创作之旅吧！进入编辑器后，我们会带你熟悉具体的功能入口。',
    icon: Check,
  },
];

export default function OnboardingGuide({ onComplete, onSkip }: OnboardingGuideProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  // 动画定时器：卸载时清理，避免卸载后 setState
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 焦点陷阱：组件挂载即代表引导显示，锁定 Tab 在模态内循环
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, []);

  // Esc 跳过引导（IME 组合输入时忽略）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onSkip]);

  const step = GUIDE_STEPS[currentStep];
  const isLast = currentStep === GUIDE_STEPS.length - 1;
  const isFirst = currentStep === 0;
  const progress = ((currentStep + 1) / GUIDE_STEPS.length) * 100;

  const handleNext = () => {
    if (isLast) {
      onComplete();
      return;
    }
    if (isAnimating) return;
    setIsAnimating(true);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => {
      setCurrentStep(prev => prev + 1);
      setIsAnimating(false);
    }, 150);
  };

  const handlePrev = () => {
    if (isFirst) return;
    if (isAnimating) return;
    setIsAnimating(true);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => {
      setCurrentStep(prev => prev - 1);
      setIsAnimating(false);
    }, 150);
  };

  const Icon = step.icon;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="新手引导"
    >
      {/* Decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Progress bar */}
        <div className="h-1 bg-ink-800 rounded-full mb-6 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Card */}
        <div className="card p-8 animate-slide-up">
          <button
            onClick={onSkip}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
            aria-label="跳过引导"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>

          {/* Step content */}
          <div className={`transition-all duration-200 ${isAnimating ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`}>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mb-6 mx-auto">
              <Icon className="w-7 h-7 text-ink-900" />
            </div>

            <h2 className="text-xl font-semibold text-ink-100 text-center mb-3">
              {step.title}
            </h2>

            <p className="text-sm text-ink-400 text-center leading-relaxed mb-8">
              {step.description}
            </p>

            {/* Step indicators */}
            <div className="flex items-center justify-center gap-1.5 mb-6">
              {GUIDE_STEPS.map((s, idx) => (
                <div
                  key={s.id}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx <= currentStep ? 'w-6 bg-amber-400' : 'w-1.5 bg-ink-700'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {!isFirst && (
              <button
                onClick={handlePrev}
                disabled={isAnimating}
                className="btn btn-secondary flex-1"
              >
                上一步
              </button>
            )}
            <button
              onClick={handleNext}
              disabled={isAnimating}
              className="btn btn-primary flex-1"
            >
              {isLast ? (
                <>开始创作</>
              ) : (
                <>
                  下一步
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {!isLast && (
            <button
              onClick={onSkip}
              className="w-full mt-3 text-xs text-ink-500 hover:text-ink-400 transition-colors"
            >
              跳过引导
            </button>
          )}
        </div>

        {/* Step counter */}
        <p className="text-center text-xs text-ink-600 mt-4">
          {currentStep + 1} / {GUIDE_STEPS.length}
        </p>
      </div>
    </div>
  );
}
