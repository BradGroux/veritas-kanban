export const VERITAS_UI_METRICS = {
  actionMinHeight: 34,
  iconActionSize: 34,
  actionRadius: 6,
  pillMinHeight: 22,
  pillRadius: 6,
  surfaceRadius: 8,
  iconGap: 6,
} as const;

export type VeritasSemanticTone =
  'neutral' | 'info' | 'success' | 'warning' | 'error' | 'blocked' | 'selection';

interface SemanticSwatch {
  foreground: string;
  background: string;
  border: string;
}

type SemanticPalette = Record<VeritasSemanticTone, SemanticSwatch>;

export const VERITAS_SEMANTIC_PALETTE: Record<'light' | 'dark', SemanticPalette> = {
  light: {
    neutral: { foreground: '#3f3f46', background: '#f4f4f5', border: '#d4d4d8' },
    info: { foreground: '#1e40af', background: '#dbeafe', border: '#93c5fd' },
    success: { foreground: '#166534', background: '#dcfce7', border: '#86efac' },
    warning: { foreground: '#854d0e', background: '#fef3c7', border: '#fcd34d' },
    error: { foreground: '#991b1b', background: '#fee2e2', border: '#fca5a5' },
    blocked: { foreground: '#9f1239', background: '#ffe4e6', border: '#fda4af' },
    selection: { foreground: '#4c1d95', background: '#ede9fe', border: '#c4b5fd' },
  },
  dark: {
    neutral: { foreground: '#e4e4e7', background: '#27272a', border: '#52525b' },
    info: { foreground: '#bfdbfe', background: '#172554', border: '#1d4ed8' },
    success: { foreground: '#bbf7d0', background: '#052e16', border: '#15803d' },
    warning: { foreground: '#fde68a', background: '#422006', border: '#a16207' },
    error: { foreground: '#fecaca', background: '#450a0a', border: '#b91c1c' },
    blocked: { foreground: '#fecdd3', background: '#4c0519', border: '#be123c' },
    selection: { foreground: '#ddd6fe', background: '#2e1065', border: '#7c3aed' },
  },
} as const;

export const VERITAS_TONE_TO_MANTINE_COLOR: Record<VeritasSemanticTone, string> = {
  neutral: 'gray',
  info: 'blue',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  blocked: 'red',
  selection: 'veritas',
};
