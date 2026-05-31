import { createTheme, type MantineColorsTuple } from '@mantine/core';

export const veritasPrimary: MantineColorsTuple = [
  '#f4f1ff',
  '#e6dcff',
  '#cab8ff',
  '#aa8eff',
  '#8d68f8',
  '#754fe8',
  '#6541d5',
  '#5132b4',
  '#412996',
  '#37267a',
];

export const veritasStatusColors = {
  blocked: '#f59f00',
  needsReview: '#228be6',
  running: '#7950f2',
  done: '#2f9e44',
  failed: '#fa5252',
  warning: '#f08c00',
  policyDenied: '#e03131',
  destructive: '#e03131',
} as const;

export const veritasMantineTheme = createTheme({
  primaryColor: 'veritas',
  primaryShade: { light: 6, dark: 4 },
  colors: {
    veritas: veritasPrimary,
  },
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMonospace:
    "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, ui-monospace, monospace",
  headings: {
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontWeight: '650',
  },
  defaultRadius: 'sm',
  radius: {
    xs: '3px',
    sm: '5px',
    md: '7px',
    lg: '10px',
    xl: '14px',
  },
  spacing: {
    xs: '0.375rem',
    sm: '0.5rem',
    md: '0.75rem',
    lg: '1rem',
    xl: '1.5rem',
  },
  fontSizes: {
    xs: '0.75rem',
    sm: '0.8125rem',
    md: '0.875rem',
    lg: '1rem',
    xl: '1.125rem',
  },
  lineHeights: {
    xs: '1.25',
    sm: '1.35',
    md: '1.45',
    lg: '1.5',
    xl: '1.55',
  },
  shadows: {
    xs: '0 1px 2px rgba(0, 0, 0, 0.2)',
    sm: '0 4px 12px rgba(0, 0, 0, 0.18)',
    md: '0 10px 30px rgba(0, 0, 0, 0.22)',
    lg: '0 20px 50px rgba(0, 0, 0, 0.28)',
    xl: '0 28px 70px rgba(0, 0, 0, 0.32)',
  },
  breakpoints: {
    xs: '36em',
    sm: '48em',
    md: '62em',
    lg: '75em',
    xl: '88em',
  },
  focusRing: 'always',
  respectReducedMotion: true,
  cursorType: 'pointer',
  autoContrast: true,
  other: {
    density: {
      controlHeight: 34,
      compactControlHeight: 30,
      panelRadius: 7,
      cardRadius: 7,
    },
    statusColors: veritasStatusColors,
  },
  components: {
    Button: {
      defaultProps: {
        radius: 'sm',
      },
    },
    ActionIcon: {
      defaultProps: {
        radius: 'sm',
        variant: 'subtle',
      },
    },
    Modal: {
      defaultProps: {
        radius: 'md',
        centered: true,
        overlayProps: { blur: 2, opacity: 0.45 },
      },
    },
    Drawer: {
      defaultProps: {
        overlayProps: { blur: 2, opacity: 0.35 },
      },
    },
    TextInput: {
      defaultProps: {
        radius: 'sm',
      },
    },
    Textarea: {
      defaultProps: {
        radius: 'sm',
      },
    },
    Select: {
      defaultProps: {
        radius: 'sm',
      },
    },
  },
});
