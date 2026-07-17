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

const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^:]*)$/i;

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
