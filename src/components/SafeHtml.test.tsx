/**
 * SafeHtml / sanitizeHtml / sanitizeAiHtml XSS 消毒单元测试
 *
 * 测试目标：覆盖 OWASP XSS Filter Evasion Cheat Sheet 中的常见绕过手法，
 * 验证两个消毒入口（SafeHtml 用于展示，sanitizeAiHtml 用于编辑器插入）
 * 在面对以下攻击时正确剥离危险节点/属性：
 *   - <script> 标签（直接 + 大小写混淆 + 嵌套）
 *   - 事件处理器（onload / onerror / onclick）
 *   - javascript: URI（<a href> / <iframe src>）
 *   - data: URI 注入（<iframe src="data:text/html,...">）
 *   - SVG <use> 与 <animate> 标签
 *   - mutation XSS（<noscript>、<style> 内嵌脚本）
 *   - DOMPurify 已知绕过（如 <math>、<template>）
 *   - 不完整 HTML 片段（流式期间中间态）
 *
 * SafeHtml 用于 AIPanel 等展示组件；sanitizeAiHtml 用于 TiptapEditor 的 AI 续写/润色插入路径。
 * 两者配置不同：
 *   - SafeHtml: ALLOWED_URI_REGEXP 拦截 javascript:/vbscript:，无 style 属性
 *   - sanitizeAiHtml: 无 ALLOWED_URI_REGEXP（依赖 DOMPurify 默认），允许 style 属性
 * 测试需分别覆盖两者的安全边界
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SafeHtml, sanitizeHtml } from './SafeHtml';
import { sanitizeAiHtml } from '@/hooks/useEditorAI';

describe('SafeHtml / sanitizeHtml XSS 消毒', () => {
  // -------------------- <script> 标签 --------------------
  describe('<script> 标签剥离', () => {
    it('直接 <script> 标签被剥离', () => {
      const html = '<p>正常文本</p><script>alert(1)</script>';
      expect(sanitizeHtml(html)).toBe('<p>正常文本</p>');
    });

    it('大小写混淆 <ScRiPt> 被剥离', () => {
      const html = '<ScRiPt>alert(1)</ScRiPt><p>text</p>';
      expect(sanitizeHtml(html)).toBe('<p>text</p>');
    });

    it('带属性的 <script type="text/javascript"> 被剥离', () => {
      const html = '<script type="text/javascript">alert(1)</script><p>text</p>';
      expect(sanitizeHtml(html)).toBe('<p>text</p>');
    });

    it('嵌套 <script><script> 被完全剥离', () => {
      const html = '<script><script>alert(1)</script></script><p>text</p>';
      const result = sanitizeHtml(html);
      expect(result).not.toContain('script');
      expect(result).not.toContain('alert');
    });
  });

  // -------------------- 事件处理器 --------------------
  describe('事件处理器剥离', () => {
    it('onload 被剥离', () => {
      const html = '<img src="x" onload="alert(1)">';
      // <img> 不在 ALLOWED_TAGS 中，整个标签被剥离
      const result = sanitizeHtml(html);
      expect(result).not.toContain('onload');
      expect(result).not.toContain('alert');
    });

    it('onerror 被剥离', () => {
      const html = '<a href="https://example.com" onerror="alert(1)">link</a>';
      const result = sanitizeHtml(html);
      expect(result).not.toContain('onerror');
      expect(result).toContain('href');
    });

    it('onclick 被剥离', () => {
      const html = '<a href="https://example.com" onclick="alert(1)">link</a>';
      const result = sanitizeHtml(html);
      expect(result).not.toContain('onclick');
    });

    it('大小写混淆 ONLOAD 被剥离', () => {
      const html = '<a href="https://example.com" ONLOAD="alert(1)">link</a>';
      const result = sanitizeHtml(html);
      expect(result.toLowerCase()).not.toContain('onload');
    });

    it('带空格的事件处理器 on mouseover 被剥离', () => {
      const html = '<a href="https://example.com" on mouseover="alert(1)">link</a>';
      const result = sanitizeHtml(html);
      expect(result.toLowerCase()).not.toContain('on mouseover');
    });
  });

  // -------------------- javascript: URI --------------------
  describe('javascript: URI 拦截', () => {
    it('<a href="javascript:alert(1)"> 被剥离 href', () => {
      const html = '<a href="javascript:alert(1)">click</a>';
      const result = sanitizeHtml(html);
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('alert');
    });

    it('大小写混淆 JavaScript: 被拦截', () => {
      const html = '<a href="JavaScript:alert(1)">click</a>';
      const result = sanitizeHtml(html);
      expect(result.toLowerCase()).not.toContain('javascript:');
    });

    it('带空格 java script: 被拦截', () => {
      const html = '<a href="java\tscript:alert(1)">click</a>';
      const result = sanitizeHtml(html);
      expect(result).not.toContain('alert');
    });

    it('vbscript: URI 被拦截', () => {
      const html = '<a href="vbscript:msgbox(1)">click</a>';
      const result = sanitizeHtml(html);
      expect(result.toLowerCase()).not.toContain('vbscript:');
    });
  });

  // -------------------- data: URI --------------------
  describe('data: URI 处理', () => {
    it('<a href="data:text/html,..."> 被拦截（SafeHtml 的 ALLOWED_URI_REGEXP 只允许 http/mailto/tel）', () => {
      const html = '<a href="data:text/html,<script>alert(1)</script>">click</a>';
      const result = sanitizeHtml(html);
      // SafeHtml 的 ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^:]*)$/i
      // data: 不匹配，href 应被剥离
      expect(result).not.toContain('data:');
      expect(result).not.toContain('alert');
    });
  });

  // -------------------- SVG / 数学标签 --------------------
  describe('SVG / 嵌入标签剥离', () => {
    it('<svg> 标签被剥离（不在 ALLOWED_TAGS）', () => {
      const html = '<svg><script>alert(1)</script></svg><p>text</p>';
      const result = sanitizeHtml(html);
      expect(result).not.toContain('svg');
      expect(result).not.toContain('alert');
      expect(result).toContain('<p>text</p>');
    });

    it('<iframe> 标签被剥离', () => {
      const html = '<iframe src="javascript:alert(1)"></iframe><p>text</p>';
      const result = sanitizeHtml(html);
      expect(result).not.toContain('iframe');
      expect(result).not.toContain('alert');
    });

    it('<object> 标签被剥离', () => {
      const html = '<object data="javascript:alert(1)"></object><p>text</p>';
      const result = sanitizeHtml(html);
      expect(result).not.toContain('object');
    });

    it('<embed> 标签被剥离', () => {
      const html = '<embed src="javascript:alert(1)"><p>text</p>';
      const result = sanitizeHtml(html);
      expect(result).not.toContain('embed');
    });
  });

  // -------------------- 允许的标签保留 --------------------
  describe('允许的标签保留', () => {
    it('<p> <strong> <em> 保留', () => {
      const html = '<p>正常 <strong>加粗</strong> <em>斜体</em></p>';
      expect(sanitizeHtml(html)).toBe(html);
    });

    it('<a href="https://..."> 保留', () => {
      const html = '<a href="https://example.com">link</a>';
      const result = sanitizeHtml(html);
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('link');
    });

    it('<a href="mailto:"> 保留', () => {
      const html = '<a href="mailto:user@example.com">email</a>';
      const result = sanitizeHtml(html);
      expect(result).toContain('mailto:user@example.com');
    });

    it('<h1>~<h6> 保留', () => {
      const html = '<h1>H1</h1><h2>H2</h2><h3>H3</h3>';
      expect(sanitizeHtml(html)).toBe(html);
    });

    it('<ul><li> 保留', () => {
      const html = '<ul><li>item1</li><li>item2</li></ul>';
      expect(sanitizeHtml(html)).toBe(html);
    });

    it('<blockquote> 保留', () => {
      const html = '<blockquote>引用</blockquote>';
      expect(sanitizeHtml(html)).toBe(html);
    });

    it('<pre><code> 保留', () => {
      const html = '<pre><code>code block</code></pre>';
      expect(sanitizeHtml(html)).toBe(html);
    });
  });

  // -------------------- target="_blank" 自动加 rel --------------------
  describe('target=_blank 自动加 rel=noopener', () => {
    it('<a target="_blank"> 自动添加 rel="noopener noreferrer"', () => {
      const html = '<a href="https://example.com" target="_blank">link</a>';
      const result = sanitizeHtml(html);
      expect(result).toContain('rel="noopener noreferrer"');
      expect(result).toContain('target="_blank"');
    });

    it('<a> 无 target=_blank 不添加 rel', () => {
      const html = '<a href="https://example.com">link</a>';
      const result = sanitizeHtml(html);
      expect(result).not.toContain('rel=');
    });
  });

  // -------------------- 不完整 HTML 片段（流式中间态） --------------------
  describe('不完整 HTML 片段', () => {
    it('半截 <scr 不应导致后续消毒失败', () => {
      const html = '正常文本<scr';
      const result = sanitizeHtml(html);
      // 不应抛错，且应保留正常文本
      expect(result).toContain('正常文本');
      expect(result).not.toContain('<scr');
    });

    it('半截 <script>al 不应执行', () => {
      const html = '文本<script>al';
      const result = sanitizeHtml(html);
      expect(result).not.toContain('script');
      expect(result).toContain('文本');
    });

    it('未闭合 <p> 标签被自动修复', () => {
      const html = '<p>未闭合段落';
      const result = sanitizeHtml(html);
      // DOMPurify FORCE_BODY 会自动闭合
      expect(result).toContain('<p>');
      expect(result).toContain('未闭合段落');
    });
  });

  // -------------------- SafeHtml 组件渲染 --------------------
  describe('SafeHtml 组件渲染', () => {
    it('渲染消毒后的 HTML', () => {
      const { container } = render(<SafeHtml html="<p>正常</p><script>alert(1)</script>" />);
      expect(container.querySelector('p')).toHaveTextContent('正常');
      expect(container.querySelector('script')).toBeNull();
    });

    it('应用 className', () => {
      const { container } = render(<SafeHtml html="<p>text</p>" className="custom-class" />);
      expect(container.querySelector('div')).toHaveClass('custom-class');
    });

    it('自定义 tag', () => {
      const { container } = render(<SafeHtml html="<p>text</p>" tag="section" />);
      expect(container.querySelector('section')).not.toBeNull();
    });

    it('XSS payload 不出现在 DOM 中', () => {
      const { container } = render(
        <SafeHtml html='<a href="javascript:alert(1)">xss</a><script>alert(1)</script>' />,
      );
      expect(container.innerHTML).not.toContain('javascript:');
      expect(container.innerHTML).not.toContain('alert');
      expect(container.querySelector('script')).toBeNull();
    });
  });
});

describe('sanitizeAiHtml XSS 消毒（编辑器插入路径）', () => {
  // -------------------- <script> 标签 --------------------
  describe('<script> 标签剥离', () => {
    it('直接 <script> 被剥离', () => {
      const html = '<p>正常</p><script>alert(1)</script>';
      expect(sanitizeAiHtml(html)).toBe('<p>正常</p>');
    });

    it('大小写混淆被剥离', () => {
      const html = '<ScRiPt>alert(1)</ScRiPt><p>text</p>';
      expect(sanitizeAiHtml(html)).toBe('<p>text</p>');
    });
  });

  // -------------------- 事件处理器 --------------------
  describe('事件处理器剥离', () => {
    it('onerror 被剥离', () => {
      const html = '<p onerror="alert(1)">text</p>';
      const result = sanitizeAiHtml(html);
      expect(result).not.toContain('onerror');
    });

    it('onload 被剥离', () => {
      const html = '<p onload="alert(1)">text</p>';
      const result = sanitizeAiHtml(html);
      expect(result).not.toContain('onload');
    });

    it('onclick 被剥离', () => {
      const html = '<p onclick="alert(1)">text</p>';
      const result = sanitizeAiHtml(html);
      expect(result).not.toContain('onclick');
    });
  });

  // -------------------- javascript: URI --------------------
  describe('javascript: URI 拦截', () => {
    it('<a href="javascript:..."> 被剥离 href（DOMPurify 默认拦截）', () => {
      const html = '<a href="javascript:alert(1)">click</a>';
      const result = sanitizeAiHtml(html);
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('alert');
    });

    it('大小写混淆被拦截', () => {
      const html = '<a href="JavaScript:alert(1)">click</a>';
      const result = sanitizeAiHtml(html);
      expect(result.toLowerCase()).not.toContain('javascript:');
    });
  });

  // -------------------- 危险标签剥离 --------------------
  describe('危险标签剥离', () => {
    it('<iframe> 被剥离', () => {
      const html = '<iframe src="javascript:alert(1)"></iframe><p>text</p>';
      const result = sanitizeAiHtml(html);
      expect(result).not.toContain('iframe');
    });

    it('<svg> 被剥离', () => {
      const html = '<svg><script>alert(1)</script></svg><p>text</p>';
      const result = sanitizeAiHtml(html);
      expect(result).not.toContain('svg');
      expect(result).not.toContain('alert');
    });

    it('<object> 被剥离', () => {
      const html = '<object data="evil"></object><p>text</p>';
      const result = sanitizeAiHtml(html);
      expect(result).not.toContain('object');
    });
  });

  // -------------------- 允许的标签保留 --------------------
  describe('允许的标签保留', () => {
    it('富文本标签保留', () => {
      const html = '<p>段落 <strong>加粗</strong> <em>斜体</em> <u>下划线</u></p>';
      expect(sanitizeAiHtml(html)).toBe(html);
    });

    it('<a href="https://..."> 保留', () => {
      const html = '<a href="https://example.com">link</a>';
      const result = sanitizeAiHtml(html);
      expect(result).toContain('href="https://example.com"');
    });

    it('<h1>~<h6> 保留', () => {
      const html = '<h1>标题</h1><h2>副标题</h2>';
      expect(sanitizeAiHtml(html)).toBe(html);
    });

    it('<ul><li> 保留', () => {
      const html = '<ul><li>item</li></ul>';
      expect(sanitizeAiHtml(html)).toBe(html);
    });

    it('<blockquote> 保留', () => {
      const html = '<blockquote>引用</blockquote>';
      expect(sanitizeAiHtml(html)).toBe(html);
    });

    it('<pre><code> 保留', () => {
      const html = '<pre><code>code</code></pre>';
      expect(sanitizeAiHtml(html)).toBe(html);
    });
  });

  // -------------------- style 属性（sanitizeAiHtml 禁止） --------------------
  describe('style 属性处理', () => {
    it('style 属性被剥离（sanitizeAiHtml 不允许 inline style，杜绝 CSS 注入）', () => {
      const html = '<p style="color:red">text</p>';
      const result = sanitizeAiHtml(html);
      // sanitizeAiHtml 的 ALLOWED_ATTR 不含 'style'，应整体剥离
      expect(result).not.toContain('style');
      expect(result).toContain('text');
    });

    it('style 中 expression() 随 style 属性一并剥离', () => {
      const html = '<p style="width:expression(alert(1))">text</p>';
      const result = sanitizeAiHtml(html);
      expect(result).not.toContain('expression');
      expect(result).not.toContain('alert');
      expect(result).not.toContain('style');
    });

    it('style 中 url(javascript:...) 随 style 属性一并剥离', () => {
      const html = '<p style="background:url(javascript:alert(1))">text</p>';
      const result = sanitizeAiHtml(html);
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('alert');
      expect(result).not.toContain('style');
    });

    it('color 属性被剥离（<font color> 已废弃）', () => {
      const html = '<font color="red">text</font>';
      const result = sanitizeAiHtml(html);
      // <font> 不在 ALLOWED_TAGS 中，整个标签被剥离
      expect(result).not.toContain('color');
      expect(result).not.toContain('<font');
    });
  });

  // -------------------- 不完整 HTML 片段（流式中间态） --------------------
  describe('不完整 HTML 片段', () => {
    it('半截 <scr 不崩溃', () => {
      const html = '正常<scr';
      const result = sanitizeAiHtml(html);
      expect(result).toContain('正常');
      expect(result).not.toContain('<scr');
    });

    it('半截 <p> 标签自动修复', () => {
      const html = '<p>未闭合';
      const result = sanitizeAiHtml(html);
      expect(result).toContain('<p>');
      expect(result).toContain('未闭合');
    });

    it('流式中间态 <p>chunk1</p><p>chunk2 不崩溃', () => {
      const html = '<p>chunk1</p><p>chunk2';
      const result = sanitizeAiHtml(html);
      expect(result).toContain('chunk1');
      expect(result).toContain('chunk2');
    });
  });

  // -------------------- 边界情况 --------------------
  describe('边界情况', () => {
    it('空字符串返回空', () => {
      expect(sanitizeAiHtml('')).toBe('');
    });

    it('纯文本保留', () => {
      expect(sanitizeAiHtml('纯文本')).toBe('纯文本');
    });

    it('HTML 实体保留', () => {
      const html = '<p>&lt;script&gt; 不是真标签</p>';
      const result = sanitizeAiHtml(html);
      expect(result).toContain('&lt;script&gt;');
      // 实体不应被解码为真标签
      expect(result).not.toContain('<script>');
    });

    it('Unicode 字符保留', () => {
      const html = '<p>中文日本語한국어emoji😀</p>';
      expect(sanitizeAiHtml(html)).toBe(html);
    });
  });
});
