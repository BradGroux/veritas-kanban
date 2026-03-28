export function normalizeArrayData<T>(value: unknown): T[] {
  let current = value;

  for (let depth = 0; depth < 3; depth += 1) {
    if (Array.isArray(current)) {
      return current as T[];
    }

    if (current && typeof current === 'object' && 'data' in current) {
      current = (current as { data?: unknown }).data;
      continue;
    }

    break;
  }

  return [];
}
