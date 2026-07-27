/**
 * AITracePanel 单元测试
 *
 * 测试范围：
 *   - 标题渲染（章节/全书两种 scope）
 *   - 空内容提示（章节/全书）
 *   - 未检测状态提示
 *   - "开始检测"按钮 disabled（无内容）
 *   - 检测流程：点击 → analyzing → report 渲染
 *   - detectAITrace 抛错时 analyzing 重置 + report 清空
 *   - report 渲染：AI 率颜色、真人质感分、困惑度/突发度、句长分布、平台对照
 *   - 一键降 AI：scope=chapter + aiRate > 阈值时显示；点击调用 deAIByReport + updateChapterContent
 *   - 降 AI 抛错时 toast.error + deAIInProgress 重置
 *   - scope=book 时不显示降 AI 按钮
 *   - report 过期提示（targetText 变化）+ 重新检测
 *   - 维度展开/折叠
 *   - 卸载守卫（mountedRef）：卸载后 setTimeout 回调不报 setState 警告
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AITracePanel from '@/components/editor/AITracePanel';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/hooks/useToast';
import type { AITraceReport, AITraceIssue } from '@/utils/aiTraceDetector';
import type { Chapter } from '@/types';

// ============ mocks ============
vi.mock('@/hooks/useToast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// detectAITrace / generateDeAISuggestions / deAIByReport 通过 vi.mock 拦截，便于每个用例定制返回值
vi.mock('@/utils/aiTraceDetector', async () => {
  const actual = await vi.importActual<typeof import('@/utils/aiTraceDetector')>('@/utils/aiTraceDetector');
  return {
    ...actual,
    detectAITrace: vi.fn(),
    generateDeAISuggestions: vi.fn().mockReturnValue(['建议1', '建议2']),
    STRICTEST_THRESHOLD: actual.STRICTEST_THRESHOLD,
  };
});

vi.mock('@/utils/deAIRewriter', () => ({
  deAIByReport: vi.fn(),
}));

import { detectAITrace, generateDeAISuggestions, STRICTEST_THRESHOLD } from '@/utils/aiTraceDetector';
import { deAIByReport } from '@/utils/deAIRewriter';

// ============ fixtures ============
function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'chap-1',
    projectId: 'p1',
    parentId: null,
    title: '第一章',
    summary: '',
    order: 0,
    level: 1,
    levelType: 'chapter',
    status: 'writing',
    wordCount: 100,
    content: '<p>章节内容</p>',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReport(overrides: Partial<AITraceReport> = {}): AITraceReport {
  return {
    aiRate: 5,
    humanScore: 95,
    perplexity: 50,
    burstiness: 40,
    sentenceLengthStats: { short: 3, medium: 5, long: 2, avg: 12, stdDev: 4 },
    dimensions: [
      { name: '句式多样性', score: 20, weight: 0.3, issues: [] },
      { name: '词汇丰富度', score: 60, weight: 0.3, issues: [
        { type: '重复用词', severity: 'high', description: '重复使用"然而"', snippet: '然而然而', suggestion: '替换其中一处' },
      ] },
    ],
    verdicts: [
      { platform: '起点中文网', threshold: 30, passed: true, margin: -25, message: '通过' },
      { platform: '出版社投稿', threshold: 10, passed: true, margin: -5, message: '通过' },
    ],
    ...overrides,
  };
}

// ============ store mock ============
function mockStore(overrides: Partial<{
  chapters: Chapter[];
  currentChapterId: string | null;
  updateChapterContent: ReturnType<typeof vi.fn>;
}> = {}) {
  const updateChapterContent = overrides.updateChapterContent || vi.fn();
  // currentChapterId 显式传 null 时需尊重，仅 undefined 才用默认
  const currentChapterId = overrides.currentChapterId !== undefined
    ? overrides.currentChapterId
    : 'chap-1';
  useAppStore.setState({
    chapters: overrides.chapters ?? [makeChapter()],
    currentChapterId,
    updateChapterContent,
  });
  return { updateChapterContent };
}

describe('AITracePanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.mocked(detectAITrace).mockReset();
    vi.mocked(generateDeAISuggestions).mockReset().mockReturnValue(['建议1', '建议2']);
    vi.mocked(deAIByReport).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // 显式 advance setTimeout（runDetection 用 setTimeout(50)）
  function flush(ms = 60) {
    act(() => { vi.advanceTimersByTime(ms); });
  }

  // ============ 标题 ============
  it('章节 scope 标题渲染"（当前章节）"', () => {
    mockStore();
    render(<AITracePanel scope="chapter" />);
    expect(screen.getByText(/AI 率检测/)).toBeInTheDocument();
    expect(screen.getByText(/当前章节/)).toBeInTheDocument();
  });

  it('全书 scope 标题渲染"（全书）"', () => {
    mockStore();
    render(<AITracePanel scope="book" />);
    expect(screen.getByText(/全书/)).toBeInTheDocument();
  });

  // ============ 空内容 ============
  it('章节无内容时显示"当前章节无内容"', () => {
    mockStore({
      chapters: [makeChapter({ id: 'chap-1', content: '' })],
    });
    render(<AITracePanel scope="chapter" />);
    expect(screen.getByText('当前章节无内容')).toBeInTheDocument();
  });

  it('全书无正文时显示"全书无正文内容"', () => {
    mockStore({
      chapters: [makeChapter({ id: 'chap-1', content: '', levelType: 'chapter' })],
    });
    render(<AITracePanel scope="book" />);
    expect(screen.getByText('全书无正文内容')).toBeInTheDocument();
  });

  it('无当前章节时显示"当前章节无内容"', () => {
    mockStore({
      chapters: [makeChapter({ id: 'chap-1', content: '<p>x</p>' })],
      currentChapterId: null,
    });
    render(<AITracePanel scope="chapter" />);
    expect(screen.getByText('当前章节无内容')).toBeInTheDocument();
  });

  // ============ 未检测 ============
  it('有内容未检测时显示"点击开始检测分析 AI 痕迹"', () => {
    mockStore();
    render(<AITracePanel scope="chapter" />);
    expect(screen.getByText('点击"开始检测"分析 AI 痕迹')).toBeInTheDocument();
  });

  it('无内容时"开始检测"按钮 disabled', () => {
    mockStore({
      chapters: [makeChapter({ id: 'chap-1', content: '' })],
    });
    render(<AITracePanel scope="chapter" />);
    const btn = screen.getByText('开始检测').closest('button');
    expect(btn?.disabled).toBe(true);
  });

  it('有内容时"开始检测"按钮 enabled', () => {
    mockStore();
    render(<AITracePanel scope="chapter" />);
    const btn = screen.getByText('开始检测').closest('button');
    expect(btn?.disabled).toBe(false);
  });

  // ============ 检测流程 ============
  it('点击"开始检测"显示"检测中..."并调用 detectAITrace', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport());
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    // analyzing 期间按钮文本变为"检测中..."
    expect(screen.getByText('检测中...')).toBeInTheDocument();
    flush();
    expect(detectAITrace).toHaveBeenCalledTimes(1);
  });

  it('检测完成后渲染 report（AI 率 + 真人质感分）', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ aiRate: 5, humanScore: 95 }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.getByText('5.0')).toBeInTheDocument();
    expect(screen.getByText(/真人质感分 95/)).toBeInTheDocument();
  });

  it('检测完成后按钮文本变为"重新检测"', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport());
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.getByText('重新检测')).toBeInTheDocument();
  });

  it('detectAITrace 抛错时 analyzing 重置 + report 为空', () => {
    vi.mocked(detectAITrace).mockImplementation(() => { throw new Error('boom'); });
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    // 检测失败 → 回到未检测状态
    expect(screen.getByText('点击"开始检测"分析 AI 痕迹')).toBeInTheDocument();
    expect(screen.queryByText('检测中...')).not.toBeInTheDocument();
  });

  // ============ report 渲染 ============
  it('aiRate <= STRICTEST_THRESHOLD 显示"通过最严格标准"', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ aiRate: STRICTEST_THRESHOLD }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.getByText('通过最严格标准')).toBeInTheDocument();
  });

  it('aiRate > STRICTEST_THRESHOLD 显示"超出最严格标准"', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ aiRate: STRICTEST_THRESHOLD + 5 }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.getByText('超出最严格标准')).toBeInTheDocument();
  });

  it('渲染困惑度 + 突发度指标', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ perplexity: 50, burstiness: 40 }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.getByText('困惑度')).toBeInTheDocument();
    expect(screen.getByText('突发度')).toBeInTheDocument();
    expect(screen.getByText('用词多样')).toBeInTheDocument(); // perplexity >= 40
    expect(screen.getByText('句长多变')).toBeInTheDocument(); // burstiness >= 30
  });

  it('perplexity < 40 显示"用词重复"', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ perplexity: 30 }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.getByText('用词重复')).toBeInTheDocument();
  });

  it('burstiness < 30 显示"句长均匀"', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ burstiness: 20 }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.getByText('句长均匀')).toBeInTheDocument();
  });

  it('渲染句长分布（短/中/长句）', () => {
    vi.mocked(detectAITrace).mockReturnValue(
      makeReport({ sentenceLengthStats: { short: 3, medium: 5, long: 2, avg: 12, stdDev: 4 } })
    );
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.getByText('短句 3')).toBeInTheDocument();
    expect(screen.getByText('中句 5')).toBeInTheDocument();
    expect(screen.getByText('长句 2')).toBeInTheDocument();
  });

  it('渲染平台标准对照（通过/未通过）', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({
      verdicts: [
        { platform: '起点中文网', threshold: 30, passed: true, margin: -25, message: '通过' },
        { platform: '出版社投稿', threshold: 10, passed: false, margin: 5, message: '未通过' },
      ],
    }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.getByText('起点中文网')).toBeInTheDocument();
    expect(screen.getByText('余量 25.0%')).toBeInTheDocument();
    expect(screen.getByText('出版社投稿')).toBeInTheDocument();
    expect(screen.getByText('超 5.0%')).toBeInTheDocument();
  });

  it('渲染降 AI 优化建议', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ aiRate: STRICTEST_THRESHOLD + 5 }));
    vi.mocked(generateDeAISuggestions).mockReturnValue(['建议A', '建议B']);
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.getByText('建议A')).toBeInTheDocument();
    expect(screen.getByText('建议B')).toBeInTheDocument();
  });

  // ============ 维度展开/折叠 ============
  it('点击有问题的维度展开 issues', () => {
    const issue: AITraceIssue = {
      type: '重复用词', severity: 'high', description: '问题说明', snippet: '原文', suggestion: '建议',
    };
    vi.mocked(detectAITrace).mockReturnValue(makeReport({
      dimensions: [{ name: '词汇丰富度', score: 60, weight: 0.3, issues: [issue] }],
    }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    // 默认折叠
    expect(screen.queryByText('问题说明')).not.toBeInTheDocument();
    // 点击维度展开
    fireEvent.click(screen.getByText('词汇丰富度'));
    expect(screen.getByText('问题说明')).toBeInTheDocument();
    expect(screen.getByText('建议：建议')).toBeInTheDocument();
  });

  it('点击已展开维度折叠 issues', () => {
    const issue: AITraceIssue = {
      type: '重复用词', severity: 'high', description: '问题说明', snippet: '原文', suggestion: '建议',
    };
    vi.mocked(detectAITrace).mockReturnValue(makeReport({
      dimensions: [{ name: '词汇丰富度', score: 60, weight: 0.3, issues: [issue] }],
    }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    fireEvent.click(screen.getByText('词汇丰富度'));
    expect(screen.getByText('问题说明')).toBeInTheDocument();
    fireEvent.click(screen.getByText('词汇丰富度'));
    expect(screen.queryByText('问题说明')).not.toBeInTheDocument();
  });

  it('无 issues 的维度不展开（点击无反应）', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({
      dimensions: [{ name: '句式多样性', score: 20, weight: 0.3, issues: [] }],
    }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    fireEvent.click(screen.getByText('句式多样性'));
    // 无 issues → 不展开（也不应有展开内容）
    // 该维度 score=20 < 30 → emerald-400，存在 CheckCircle2 图标
    expect(screen.queryByText(/建议：/)).not.toBeInTheDocument();
  });

  // ============ 一键降 AI ============
  it('scope=chapter + aiRate > 阈值时显示"一键降 AI 改写"按钮', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ aiRate: STRICTEST_THRESHOLD + 5 }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.getByText(/一键降 AI 改写/)).toBeInTheDocument();
  });

  it('scope=chapter + aiRate <= 阈值时不显示降 AI 按钮', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ aiRate: STRICTEST_THRESHOLD }));
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.queryByText(/一键降 AI 改写/)).not.toBeInTheDocument();
  });

  it('scope=book 时不显示降 AI 按钮（即使 aiRate 高）', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ aiRate: 50 }));
    mockStore();
    render(<AITracePanel scope="book" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(screen.queryByText(/一键降 AI 改写/)).not.toBeInTheDocument();
  });

  it('点击"一键降 AI 改写"调用 deAIByReport + updateChapterContent', () => {
    const report = makeReport({ aiRate: STRICTEST_THRESHOLD + 5 });
    vi.mocked(detectAITrace).mockReturnValueOnce(report).mockReturnValueOnce(makeReport({ aiRate: 3 }));
    vi.mocked(deAIByReport).mockReturnValue('<p>改写后</p>');
    const { updateChapterContent } = mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    fireEvent.click(screen.getByText(/一键降 AI 改写/));
    flush();
    expect(deAIByReport).toHaveBeenCalledTimes(1);
    expect(updateChapterContent).toHaveBeenCalledWith('chap-1', '<p>改写后</p>');
  });

  it('降 AI 进行中按钮显示"降 AI 改写中..."', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ aiRate: STRICTEST_THRESHOLD + 5 }));
    vi.mocked(deAIByReport).mockReturnValue('<p>x</p>');
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    fireEvent.click(screen.getByText(/一键降 AI 改写/));
    // deAIInProgress 期间按钮文本变化（不 flush，让 setTimeout 不执行）
    expect(screen.getByText('降 AI 改写中...')).toBeInTheDocument();
  });

  it('deAIByReport 抛错时 toast.error + deAIInProgress 重置', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ aiRate: STRICTEST_THRESHOLD + 5 }));
    vi.mocked(deAIByReport).mockImplementation(() => { throw new Error('rewrite failed'); });
    mockStore();
    render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    fireEvent.click(screen.getByText(/一键降 AI 改写/));
    flush();
    expect(toast.error).toHaveBeenCalledWith('降 AI 改写失败', 'rewrite failed');
    // 重置后按钮恢复
    expect(screen.getByText(/一键降 AI 改写/)).toBeInTheDocument();
  });

  // ============ report 过期 ============
  it('内容修改后显示"内容已修改"过期提示', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport());
    mockStore();
    const { rerender } = render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    // 修改章节内容
    act(() => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'chap-1', content: '<p>新内容</p>' })],
      });
    });
    rerender(<AITracePanel scope="chapter" />);
    expect(screen.getByText('内容已修改，检测结果可能过期')).toBeInTheDocument();
  });

  it('过期状态下"一键降 AI 改写"按钮 disabled', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport({ aiRate: STRICTEST_THRESHOLD + 5 }));
    mockStore();
    const { rerender } = render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    act(() => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'chap-1', content: '<p>新内容</p>' })],
      });
    });
    rerender(<AITracePanel scope="chapter" />);
    const deAIBtn = screen.getByText(/一键降 AI 改写/).closest('button');
    expect(deAIBtn?.disabled).toBe(true);
  });

  it('过期状态下点击"重新检测"按钮重新调用 detectAITrace', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport());
    mockStore();
    const { rerender } = render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    expect(detectAITrace).toHaveBeenCalledTimes(1);
    act(() => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'chap-1', content: '<p>新内容</p>' })],
      });
    });
    rerender(<AITracePanel scope="chapter" />);
    // 过期提示框中的"重新检测"按钮（顶部按钮也同名，取第二个）
    const reDetectBtns = screen.getAllByText('重新检测');
    expect(reDetectBtns.length).toBe(2);
    fireEvent.click(reDetectBtns[1]);
    flush();
    expect(detectAITrace).toHaveBeenCalledTimes(2);
  });

  // ============ 全书 scope ============
  it('全书 scope 拼接所有正文章节内容', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport());
    mockStore({
      chapters: [
        makeChapter({ id: 'c1', content: '<p>章节1</p>', levelType: 'chapter' }),
        makeChapter({ id: 'v1', content: '<p>卷</p>', levelType: 'volume' }),
        makeChapter({ id: 'c2', content: '<p>章节2</p>', levelType: 'part' }),
      ],
    });
    render(<AITracePanel scope="book" />);
    fireEvent.click(screen.getByText('开始检测'));
    flush();
    // chapter + part 拼接，volume 跳过
    expect(detectAITrace).toHaveBeenCalledWith(expect.stringContaining('章节1'));
    expect(detectAITrace).toHaveBeenCalledWith(expect.stringContaining('章节2'));
    // volume 内容不应出现
    const callArg = vi.mocked(detectAITrace).mock.calls[0][0];
    expect(callArg).not.toContain('卷');
  });

  // ============ 卸载守卫 ============
  it('卸载后 setTimeout 回调不报错（mountedRef 守卫）', () => {
    vi.mocked(detectAITrace).mockReturnValue(makeReport());
    mockStore();
    const { unmount } = render(<AITracePanel scope="chapter" />);
    fireEvent.click(screen.getByText('开始检测'));
    // 卸载后 advance timers，不应抛 React 警告
    unmount();
    expect(() => {
      act(() => { vi.advanceTimersByTime(100); });
    }).not.toThrow();
  });
});
