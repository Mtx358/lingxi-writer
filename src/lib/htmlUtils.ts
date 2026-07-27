/**
 * HTML 转义公共工具
 *
 * 统一收敛散落在 outlineParser / humanizeText / importUtils / deAIRewriter / diff
 * 中的 escapeHtml 实现。替换 & < > " ' 五个字符：
 * - & < > 防止元素文本中的标签 breakout
 * - " ' 兼容未来属性值场景（<a title="${escapeHtml(x)}">），避免属性 breakout XSS
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
