import type { MantineColorScheme } from '@mantine/core';

export type VeritasColorScheme = 'light' | 'dark';

export const VERITAS_COLOR_SCHEME_STORAGE_KEY = 'veritas-kanban-theme';

export function normalizeVeritasColorScheme(value: MantineColorScheme): VeritasColorScheme {
  return value === 'light' ? 'light' : 'dark';
}

export function applyVeritasColorScheme(value: VeritasColorScheme): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.dataset.mantineColorScheme = value;
  root.classList.toggle('dark', value === 'dark');
}
