/**
 * Server-side HTML sanitization for XSS defense-in-depth.
 *
 * The web frontend already sanitizes via DOMPurify, but non-browser API
 * consumers (mobile apps, CLI tools, third-party integrations) could be
 * vulnerable to stored XSS if the server stores payloads verbatim.
 *
 * Policy:
 *   - Task titles:      strip ALL HTML tags (plain text only)
 *   - Task descriptions: strip ALL HTML tags (plain text only — markdown is rendered client-side)
 *   - Comments:          strip ALL HTML tags (plain text only)
 *   - Author names:      strip ALL HTML tags
 *
 * @see docs/SECURITY_AUDIT_2026-01-28.md — MED-1
 */

import sanitizeHtml from 'sanitize-html';

/**
 * Strip ALL HTML tags, returning clean plain text.
 *
 * - Normal tag content is preserved: `<b>bold</b>` → `bold`
 * - Script/style content is discarded: `<script>alert(1)</script>` → ``
 * - Event handlers are removed: `<img onerror=alert(1)>` → ``
 */
export function stripHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    // 'discard' (default) strips disallowed tags.
    // Content inside nonTextTags (script, style, textarea, option, noscript)
    // is automatically discarded by sanitize-html.
    disallowedTagsMode: 'discard',
  });
}

/**
 * Sanitize task fields in-place on a create/update payload.
 * Only sanitizes fields that are present (defined) on the input.
 */
export function sanitizeTaskFields(input: { title?: string; description?: string }): void {
  if (input.title !== undefined) {
    input.title = stripHtml(input.title);
  }
  if (input.description !== undefined) {
    input.description = stripHtml(input.description);
  }
}

/**
 * Sanitize comment text.
 */
export function sanitizeCommentText(text: string): string {
  return stripHtml(text);
}

/**
 * Sanitize author name.
 */
export function sanitizeAuthor(author: string): string {
  return stripHtml(author);
}
