import { useState, useRef, useCallback, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useAppStore } from '@/store/useAppStore';
import type { Material, MaterialAttachment, MaterialQuestion } from '@/types';
import { generateId } from '@/utils/storage';
import { askMaterialQuestion } from '@/utils/aiService';
import { clearImageErrorCache } from '@/utils/imageCache';
import { toast } from '@/hooks/useToast';
import { confirm } from '@/hooks/useConfirm';

interface UseMaterialsActionsParams {
  newTitle: string;
  newType: Material['type'];
  setNewTitle: Dispatch<SetStateAction<string>>;
  setShowAdd: Dispatch<SetStateAction<boolean>>;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
}

export function useMaterialsActions({
  newTitle,
  newType,
  setNewTitle,
  setShowAdd,
  setExpandedId,
}: UseMaterialsActionsParams) {
  const addMaterial = useAppStore(s => s.addMaterial);
  const updateMaterial = useAppStore(s => s.updateMaterial);
  const currentProjectId = useAppStore(s => s.currentProjectId);

  // 卡片促活：AI 对素材卡深度提问
  const [questionTargetId, setQuestionTargetId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<MaterialQuestion[]>([]);
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  // 并发守卫：用户连续点击不同卡片触发"深度提问"时，旧请求晚于新请求返回会
  // 把旧问题列表覆盖到新卡片上。用 ref 记录最新请求 ID，await 后比对丢弃旧响应。
  const askRequestIdRef = useRef(0);
  // Drawer 关闭/组件 unmount 后取消 in-flight 请求的写入：避免无效 setState
  const drawerOpenRef = useRef(false);

  // 组件 unmount 时让在飞请求作废：increment 操作不依赖 ref 当前值，
  // 仅需保证 unmount 后任何在飞请求检查 reqId !== askRequestIdRef.current 时为 true。
  // react-hooks/exhaustive-deps 对 ref.current 的 cleanup 警告在此场景为误报
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      askRequestIdRef.current++;
    };
  }, []);

  // 关闭深度提问抽屉：同时标记 ref，使任何在飞的请求返回时丢弃写入，避免
  // 在组件已 unmount / 抽屉已关闭后调用 setQuestions 触发 React 警告
  const closeQuestionDrawer = useCallback(() => {
    drawerOpenRef.current = false;
    setQuestionTargetId(null);
  }, []);

  const handleAskQuestion = useCallback(async (mat: Material) => {
    const reqId = ++askRequestIdRef.current;
    setQuestionTargetId(mat.id);
    setQuestions([]);
    setAnswers({});
    setAsking(true);
    drawerOpenRef.current = true;
    try {
      const result = await askMaterialQuestion(mat);
      // 期间用户又点了别的卡片 / 关闭了抽屉 / 卸载了组件 → 丢弃本次结果
      if (reqId !== askRequestIdRef.current) return;
      if (!drawerOpenRef.current) return;
      setQuestions(result);
    } catch (err) {
      // 捕获 reject 避免 unhandled rejection：仅当本次仍是最新请求且抽屉仍打开时提示错误
      if (reqId === askRequestIdRef.current && drawerOpenRef.current) {
        toast.error('提问失败', err instanceof Error ? err.message : String(err));
      }
    } finally {
      // 仅当本次仍是最新请求时才复位 asking，避免覆盖更新的请求的 loading 状态
      if (reqId === askRequestIdRef.current) setAsking(false);
    }
  }, []);

  // 把某条回答生成为子卡片：复用 Material.references 作为父子关联
  const handleSpawnChild = useCallback((question: MaterialQuestion, answer: string) => {
    if (!answer.trim() || !questionTargetId) return;
    // 从 store 读取最新 parent：连续生成多个子卡时闭包中的 materials 已陈旧，
    // 直接用 parent.references 会覆盖前一个子卡的关联，导致父卡丢失旧子卡引用
    const parent = useAppStore.getState().materials.find(m => m.id === questionTargetId);
    if (!parent) return;
    const child = addMaterial({
      title: `[${question.dimension}] ${question.question.slice(0, 20)}`,
      type: parent.type,
      content: answer.trim(),
      tags: [...parent.tags, '深度提问'],
      category: parent.category,
      references: [parent.id], // 父子关联
    });
    // 父卡也补一条引用，方便双向追溯；从最新 parent 计算 references 避免覆盖前一个子卡
    updateMaterial(parent.id, { references: [...(parent.references || []), child.id] });
  }, [questionTargetId, addMaterial, updateMaterial]);

  const handleAdd = useCallback(() => {
    if (!newTitle.trim()) return;
    addMaterial({ title: newTitle.trim(), type: newType });
    setNewTitle('');
    setShowAdd(false);
  }, [newTitle, newType, addMaterial, setNewTitle, setShowAdd]);

  const handleAddAttachment = useCallback(async (mat: Material) => {
    const api = window.electronAPI;
    if (!api) {
      alert('需要桌面版才能添加附件');
      return;
    }
    if (!currentProjectId) {
      alert('未打开项目，无法添加附件');
      return;
    }
    // try/catch 包裹：selectFile 用户取消时 resolve 为 null，但 IO 错误/权限问题会 reject；
    // saveAttachment 同样可能 reject（磁盘满/权限不足）。无 catch 时变成未处理 Promise 拒绝，
    // 用户看不到任何反馈且后续步骤被跳过
    try {
      const fileInfo = await api.dialog.selectFile();
      if (!fileInfo) return;
      const attachmentId = generateId();
      // 将源文件复制到项目数据目录，避免原文件移动/删除后失效；杜绝 base64 内嵌
      const persistedPath = await api.material.saveAttachment(fileInfo.path, currentProjectId, attachmentId);
      // S4: 新增附件时清除该路径的错误缓存，覆盖"用户修复/替换文件后重新添加"场景
      clearImageErrorCache(persistedPath || fileInfo.path);
      const newAttachment: MaterialAttachment = {
        id: attachmentId,
        name: fileInfo.name,
        path: persistedPath || fileInfo.path, // 复制失败时回退到原路径
        size: fileInfo.size,
        ext: fileInfo.ext,
        addedAt: new Date().toISOString(),
      };
      updateMaterial(mat.id, { attachments: [...(mat.attachments || []), newAttachment] });
    } catch (e) {
      console.error('handleAddAttachment failed:', e);
      toast.error('添加附件失败', e instanceof Error ? e.message : '请检查文件权限或路径');
    }
  }, [currentProjectId, updateMaterial]);

  const handleOpenAttachment = useCallback(async (att: MaterialAttachment) => {
    const api = window.electronAPI;
    if (!api) {
      alert('需要桌面版才能打开附件');
      return;
    }
    // openExternal 在文件已删除/权限不足/无关联程序时会 reject，无 catch 时静默失败，用户无反馈
    try {
      await api.file.openExternal(att.path);
    } catch (e) {
      console.error('handleOpenAttachment failed:', e);
      toast.error('打开附件失败', e instanceof Error ? e.message : '文件可能已被删除或无关联程序');
    }
  }, []);

  const handleRemoveAttachment = useCallback(async (mat: Material, att: MaterialAttachment) => {
    const attName = att.name || att.path;
    if (!(await confirm(`确定删除附件"${attName}"吗？\n\n磁盘上的副本文件也会尝试一并删除。`))) return;
    const next = (mat.attachments || []).filter(a => a.id !== att.id);
    updateMaterial(mat.id, { attachments: next });
    // 尝试删除磁盘副本：bridge 不支持或失败时静默忽略（用户已确认移除记录）
    // window.electronAPI 类型已在 vite-env.d.ts 全局声明，无需重复断言
    // web 环境下 electronAPI 为 undefined，需用 ?. 守卫调用与返回值，否则 .catch 会抛 TypeError
    window.electronAPI?.material?.deleteAttachment?.(att.path)?.catch(() => { /* 静默：记录已移除即可 */ });
  }, [updateMaterial]);

  // 列表项展开/折叠与置顶切换：稳定回调避免所有列表项重渲染
  const handleToggleExpand = useCallback((mat: Material) => {
    setExpandedId(prev => (prev === mat.id ? null : mat.id));
  }, [setExpandedId]);

  const handleTogglePinned = useCallback((mat: Material) => {
    updateMaterial(mat.id, { pinned: !mat.pinned });
  }, [updateMaterial]);

  const onAnswerChange = useCallback((index: number, value: string) => {
    setAnswers(prev => ({ ...prev, [index]: value }));
  }, []);

  return {
    questionTargetId,
    questions,
    asking,
    answers,
    onAnswerChange,
    closeQuestionDrawer,
    handleAskQuestion,
    handleSpawnChild,
    handleAdd,
    handleAddAttachment,
    handleOpenAttachment,
    handleRemoveAttachment,
    handleToggleExpand,
    handleTogglePinned,
  };
}
