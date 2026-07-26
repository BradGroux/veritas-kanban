const FILE_PATH_KEYS = new Set([
  'file',
  'file_path',
  'filePath',
  'filepath',
  'notebook_path',
  'notebookPath',
  'path',
  'relative_path',
  'relativePath',
]);

export interface ProviderEventHunkRange {
  path: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export function extractProviderEventPaths(value: unknown): string[] {
  const paths = new Set<string>();
  const seen = new Set<object>();
  const visit = (candidate: unknown, key: string | undefined, depth: number): void => {
    if (depth > 8 || paths.size >= 100) return;
    if (typeof candidate === 'string') {
      if (!key || !FILE_PATH_KEYS.has(key)) return;
      const normalized = normalizeWorkspaceEvidencePath(candidate);
      if (normalized) paths.add(normalized);
      return;
    }
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const entry of candidate.slice(0, 100)) visit(entry, key, depth + 1);
      return;
    }
    for (const [childKey, childValue] of Object.entries(candidate as Record<string, unknown>).slice(
      0,
      256
    )) {
      visit(childValue, childKey, depth + 1);
      if (paths.size >= 100) break;
    }
  };
  visit(value, undefined, 0);
  return [...paths].sort((left, right) => left.localeCompare(right));
}

export function extractProviderEventHunkRanges(value: unknown): ProviderEventHunkRange[] {
  const ranges: ProviderEventHunkRange[] = [];
  const seen = new Set<object>();
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 8 || ranges.length >= 100 || !candidate || typeof candidate !== 'object') return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const entry of candidate.slice(0, 100)) visit(entry, depth + 1);
      return;
    }
    const record = candidate as Record<string, unknown>;
    const rawPath =
      typeof record.path === 'string'
        ? record.path
        : typeof record.file_path === 'string'
          ? record.file_path
          : typeof record.filePath === 'string'
            ? record.filePath
            : undefined;
    const path = rawPath ? normalizeWorkspaceEvidencePath(rawPath) : undefined;
    if (path && typeof record.diff === 'string' && record.diff.length <= 1_048_576) {
      for (const range of parseUnifiedDiffHunkRanges(record.diff)) {
        ranges.push({ path, ...range });
        if (ranges.length >= 100) break;
      }
    }
    for (const child of Object.values(record).slice(0, 256)) {
      visit(child, depth + 1);
      if (ranges.length >= 100) break;
    }
  };
  visit(value, 0);
  const unique = new Map(
    ranges.map((range) => [
      `${range.path}:${range.oldStart}:${range.oldLines}:${range.newStart}:${range.newLines}`,
      range,
    ])
  );
  return [...unique.values()].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.oldStart - right.oldStart ||
      left.newStart - right.newStart
  );
}

export function extractProviderEventToolName(value: unknown): string | undefined {
  const seen = new Set<object>();
  const visit = (candidate: unknown, depth: number): string | undefined => {
    if (depth > 8 || !candidate || typeof candidate !== 'object' || seen.has(candidate)) {
      return undefined;
    }
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const entry of candidate.slice(0, 100)) {
        const nested = visit(entry, depth + 1);
        if (nested) return nested;
      }
      return undefined;
    }
    const record = candidate as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
    for (const key of ['tool', 'tool_name', 'toolName', 'name']) {
      const name = record[key];
      if (
        typeof name === 'string' &&
        name.length <= 240 &&
        !hasControlCharacters(name) &&
        (key !== 'name' || type.includes('tool') || type.includes('file'))
      ) {
        return name;
      }
    }
    for (const child of Object.values(record).slice(0, 256)) {
      const nested = visit(child, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  };
  return visit(value, 0);
}

export function isWriteCapableProviderTool(toolName: string | undefined): boolean {
  if (!toolName) return false;
  const normalized = toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  return /(?:^|_)(?:write|edit|multi_edit|notebook_edit|apply_patch|applypatch|patch|replace|create_file|delete_file|rename_file|move_file)(?:_|$)/.test(
    normalized
  );
}

export function normalizeWorkspaceEvidencePath(value: string): string | undefined {
  const trimmed = value.trim().replaceAll('\\', '/');
  if (
    !trimmed ||
    trimmed.length > 2_048 ||
    hasControlCharacters(trimmed) ||
    trimmed.startsWith('/') ||
    /^[A-Za-z]:\//.test(trimmed) ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return undefined;
  }
  const segments = trimmed.replace(/^(?:\.\/)+/, '').split('/');
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  return segments.join('/');
}

function parseUnifiedDiffHunkRanges(diff: string): Array<Omit<ProviderEventHunkRange, 'path'>> {
  const ranges: Array<Omit<ProviderEventHunkRange, 'path'>> = [];
  const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  for (const match of diff.matchAll(header)) {
    const oldStart = Number(match[1]);
    const oldLines = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newLines = match[4] === undefined ? 1 : Number(match[4]);
    if (
      ![oldStart, oldLines, newStart, newLines].every(Number.isSafeInteger) ||
      oldStart > 10_000_000 ||
      newStart > 10_000_000 ||
      oldLines > 1_000_000 ||
      newLines > 1_000_000
    ) {
      continue;
    }
    ranges.push({ oldStart, oldLines, newStart, newLines });
  }
  return ranges;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
