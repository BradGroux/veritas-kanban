/**
 * Safe extraction helpers for Express 5 request params and query values.
 *
 * Express 5 types `req.params[key]` as `string | string[]` and `req.query[key]`
 * as `string | ParsedQs | (string | ParsedQs)[] | undefined`.  Raw `as string`
 * casts hide potential array/object values at the type level.  These helpers
 * narrow safely while keeping runtime behaviour unchanged (first element of an
 * array is used, just like the old casts, but now the intent is explicit and
 * type-safe).
 *
 * All functions accept `unknown` so they work with any Express query/param
 * shape without requiring callers to pre-cast.
 */

/**
 * Extract a string value from a query/param field.
 * Returns `undefined` when the field is missing, empty, or an object (ParsedQs).
 * For arrays, returns the first string element.
 */
export function qStr(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value || undefined;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first || undefined : undefined;
  }
  // ParsedQs (nested object) or other non-string — not a valid string param
  return undefined;
}

/**
 * Extract a string value with a default fallback.
 */
export function qStrD(value: unknown, defaultValue: string): string {
  return qStr(value) ?? defaultValue;
}

/**
 * Extract a numeric value from a query/param field.
 * Returns `undefined` when the field is missing or not a valid number.
 */
export function qNum(value: unknown): number | undefined {
  const s = qStr(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Extract a numeric value with a default fallback.
 */
export function qNumD(value: unknown, defaultValue: number): number {
  return qNum(value) ?? defaultValue;
}

/**
 * Extract a route parameter as a string.
 * Express 5 types params as `string | string[]`; this narrows safely.
 */
export function paramStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') return value[0];
  return '';
}
