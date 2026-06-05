const ALLOWED_ABSOLUTE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'veritas:']);
const EXTERNAL_TARGET_PROTOCOLS = new Set(['http:', 'https:']);

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function normalizeSafeHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const href = value.trim();
  if (!href || hasControlCharacter(href)) return undefined;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  if (href.startsWith('#') || href.startsWith('?')) return href;

  try {
    const parsed = new URL(href);
    return ALLOWED_ABSOLUTE_PROTOCOLS.has(parsed.protocol.toLowerCase())
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function isExternalTargetHref(value: unknown): boolean {
  const href = normalizeSafeHref(value);
  if (!href) return false;

  try {
    const parsed = new URL(href);
    return EXTERNAL_TARGET_PROTOCOLS.has(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}
