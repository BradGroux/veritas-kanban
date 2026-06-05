import { DEFAULT_FEATURE_SETTINGS, type BoardColumnConfig, type TaskStatus } from '../types.js';

export const BOARD_COLUMN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidBoardColumnId(value: string): boolean {
  return value.length >= 1 && value.length <= 50 && BOARD_COLUMN_ID_PATTERN.test(value);
}

export function normalizeBoardColumns(
  columns: BoardColumnConfig[] | undefined | null
): BoardColumnConfig[] {
  const source = columns?.length ? columns : DEFAULT_FEATURE_SETTINGS.board.columns;
  const seen = new Set<string>();
  const normalized: BoardColumnConfig[] = [];

  for (const column of source) {
    const id = String(column.id || '').trim() as TaskStatus;
    const title = String(column.title || '').trim();
    if (!id || !isValidBoardColumnId(id) || !title || title.length > 50 || seen.has(id)) continue;
    normalized.push({ id, title });
    seen.add(id);
  }

  return normalized.length > 0 ? normalized : DEFAULT_FEATURE_SETTINGS.board.columns;
}

export function normalizeBoardDefaultStatus(
  defaultStatus: TaskStatus | undefined | null,
  columns: BoardColumnConfig[]
): TaskStatus {
  const ids = new Set(columns.map((column) => column.id));
  if (defaultStatus && ids.has(defaultStatus)) return defaultStatus;
  return columns[0]?.id ?? DEFAULT_FEATURE_SETTINGS.board.defaultStatus;
}

export function getBoardStatusLabel(
  status: TaskStatus,
  columns: BoardColumnConfig[] | undefined | null
): string {
  return normalizeBoardColumns(columns).find((column) => column.id === status)?.title ?? status;
}
