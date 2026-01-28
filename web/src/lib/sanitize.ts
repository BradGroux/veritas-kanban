/**
 * Content sanitization utilities to prevent stored XSS.
 *
 * Defense-in-depth: React's JSX already escapes text content rendered via `{}`.
 * These utilities add an additional layer of protection:
 *
 * - `sanitizeHtml()` — Cleans HTML for use with dangerouslySetInnerHTML or
 *   Markdown-to-HTML renderers. Allows safe Markdown tags, strips scripts,
 *   event handlers, and javascript: links.
 *
 * - `sanitizeText()` — Strips ALL HTML for plain-text rendering contexts.
 *   Use this when content should never contain markup.
 */

import DOMPurify from 'dompurify';

/**
 * Allowed HTML tags that are safe for Markdown-rendered content.
 * These cover standard Markdown output (headings, lists, emphasis, code, etc.).
 */
const ALLOWED_TAGS = [
  // Headings
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // Block elements
  'p', 'blockquote', 'pre', 'hr', 'br', 'div',
  // Lists
  'ul', 'ol', 'li',
  // Inline formatting
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup',
  // Code
  'code', 'kbd', 'samp', 'var',
  // Links & images
  'a', 'img',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  // Definition lists
  'dl', 'dt', 'dd',
  // Details/summary
  'details', 'summary',
  // Misc inline
  'span', 'abbr', 'cite', 'q', 'small',
];

/**
 * Allowed HTML attributes. Kept minimal to reduce attack surface.
 */
const ALLOWED_ATTR = [
  // Links
  'href', 'target', 'rel',
  // Images
  'src', 'alt', 'title', 'width', 'height',
  // Tables
  'colspan', 'rowspan', 'scope',
  // General
  'class', 'id',
  // Accessibility
  'aria-label', 'aria-hidden', 'role',
  // Code highlighting
  'data-language',
];

/**
 * URI schemes allowed in href/src attributes.
 * Blocks javascript:, data:, vbscript:, etc.
 */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel|ftp):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;

/**
 * Sanitize HTML content for safe rendering.
 *
 * Use when rendering user-generated HTML (e.g., from a Markdown-to-HTML
 * converter) via `dangerouslySetInnerHTML` or similar.
 *
 * Strips:
 * - `<script>` tags and content
 * - Event handler attributes (onclick, onerror, onload, etc.)
 * - `javascript:` and other dangerous URI schemes
 * - `<style>` tags (to prevent CSS-based attacks)
 * - `<iframe>`, `<object>`, `<embed>`, `<form>` elements
 *
 * @example
 * ```tsx
 * // In a component using a Markdown renderer:
 * const html = markdownToHtml(task.description);
 * return <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
 * ```
 */
export function sanitizeHtml(dirty: string): string {
  if (!dirty) return '';

  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    // Force all links to open in new tab with safe rel
    ADD_ATTR: ['target'],
    // Strip any tag not in allowlist (don't just escape)
    KEEP_CONTENT: true,
    // Forbid dangerous tags explicitly (belt + suspenders)
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress'],
  });
}

/**
 * Strip ALL HTML from a string, returning plain text only.
 *
 * Use for content that should never contain markup — descriptions rendered
 * as plain text, comment bodies, tooltip text, etc.
 *
 * This is a defense-in-depth measure. React's JSX `{}` interpolation already
 * escapes HTML entities, but this ensures no HTML reaches the render layer
 * even if the rendering approach changes.
 *
 * @example
 * ```tsx
 * <p className="text-sm">{sanitizeText(comment.text)}</p>
 * ```
 */
export function sanitizeText(dirty: string): string {
  if (!dirty) return '';

  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [],   // Strip ALL tags
    ALLOWED_ATTR: [],   // Strip ALL attributes
    KEEP_CONTENT: true, // Keep text content of stripped tags
  });
}

/**
 * Hook DOMPurify to enforce safe link targets.
 * All <a> tags get target="_blank" and rel="noopener noreferrer".
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  // Remove any remaining javascript: URIs that might slip through
  if (node.hasAttribute('href')) {
    const href = node.getAttribute('href') || '';
    if (/^\s*javascript\s*:/i.test(href)) {
      node.removeAttribute('href');
    }
  }
  if (node.hasAttribute('src')) {
    const src = node.getAttribute('src') || '';
    if (/^\s*javascript\s*:/i.test(src)) {
      node.removeAttribute('src');
    }
  }
});
