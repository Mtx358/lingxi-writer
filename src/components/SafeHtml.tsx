import { useMemo } from 'react';
import DOMPurify from 'dompurify';

interface SafeHtmlProps {
  html: string;
  className?: string;
  tag?: keyof JSX.IntrinsicElements;
}

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'hr', 'div', 'mark',
];

const ALLOWED_ATTR = ['href', 'class', 'target', 'rel', 'data-reference-type', 'data-reference-id'];

// 允许的 URI 协议白名单（用于 href/src 等 URI 属性过滤）。
// 修复原正则 bug：`^(?:(?:https?|mailto|tel):|[^:]*)$/i` 因 `$` 锚点紧随 scheme 后，
// 实际只匹配 `https:` 这种"冒号即结尾"的字符串，导致 `https://example.com` 被误判为非法而
// 整个 href 被剥离。新正则：scheme 后允许任意字符 `.*`，或无冒号的相对路径/锚点。
// 仍然拦截 javascript:/vbscript:/data: 等危险协议（不在 scheme 白名单中）。
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):.*|[^:]*)$/i;

let hookRegistered = false;
function ensureHook() {
  if (hookRegistered) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  hookRegistered = true;
}

export function SafeHtml({ html, className, tag = 'div' }: SafeHtmlProps) {
  const sanitized = useMemo(() => {
    ensureHook();
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ADD_ATTR: ['target'],
      ALLOWED_URI_REGEXP,
      FORCE_BODY: true,
    });
  }, [html]);

  const Tag = tag;
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />;
}

// sanitizeHtml 与 SafeHtml 共享 ALLOWED_TAGS/ALLOWED_ATTR/ensureHook 等私有状态，
// 提取到独立文件会破坏封装；fast-refresh 警告为已知取舍。
// eslint-disable-next-line react-refresh/only-export-components
export function sanitizeHtml(html: string): string {
  ensureHook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR: ['target'],
    ALLOWED_URI_REGEXP,
    FORCE_BODY: true,
  });
}

export default SafeHtml;
