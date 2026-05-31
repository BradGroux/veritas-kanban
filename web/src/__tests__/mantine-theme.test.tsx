import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TextInput, useMantineTheme } from '@mantine/core';
import { useTheme } from '@/hooks/useTheme';
import { MantineRoot, testColorSchemeManager } from '@/theme/MantineRoot';
import { veritasMantineTheme, veritasStatusColors } from '@/theme/mantine-theme';

function ThemeProbe() {
  const theme = useMantineTheme();

  return (
    <div>
      <span data-testid="primary">{theme.primaryColor}</span>
      <span data-testid="blocked">{theme.other.statusColors.blocked}</span>
      <TextInput label="Probe" placeholder="Mantine input" />
    </div>
  );
}

function ThemeControlProbe() {
  const { theme, setTheme } = useTheme();

  return (
    <button type="button" onClick={() => setTheme('light')}>
      {theme}
    </button>
  );
}

describe('Mantine foundation', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    const localStorageMock: Storage = {
      get length() {
        return storage.size;
      },
      clear: vi.fn(() => storage.clear()),
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
    };

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    });

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    testColorSchemeManager.clear();
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    delete document.documentElement.dataset.mantineColorScheme;
    vi.restoreAllMocks();
  });

  it('provides the Veritas Mantine theme and default dark color scheme', async () => {
    render(
      <MantineRoot env="test">
        <ThemeProbe />
      </MantineRoot>
    );

    expect(screen.getByTestId('primary').textContent).toBe('veritas');
    expect(screen.getByTestId('blocked').textContent).toBe(veritasStatusColors.blocked);
    expect(screen.getByLabelText('Probe')).toBeDefined();

    await waitFor(() => {
      expect(document.documentElement.dataset.mantineColorScheme).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  it('bridges Mantine color scheme changes to the existing dark class contract', async () => {
    render(
      <MantineRoot env="test">
        <ThemeControlProbe />
      </MantineRoot>
    );

    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('dark'));

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toBe('light');
      expect(document.documentElement.dataset.mantineColorScheme).toBe('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  it('covers required v5 status semantics and accessibility defaults', () => {
    expect(Object.keys(veritasStatusColors).sort()).toEqual([
      'blocked',
      'destructive',
      'done',
      'failed',
      'needsReview',
      'policyDenied',
      'running',
      'warning',
    ]);
    expect(veritasMantineTheme.focusRing).toBe('always');
    expect(veritasMantineTheme.respectReducedMotion).toBe(true);
    expect(veritasMantineTheme.autoContrast).toBe(true);
    expect(veritasMantineTheme.breakpoints).toEqual({
      xs: '36em',
      sm: '48em',
      md: '62em',
      lg: '75em',
      xl: '88em',
    });
  });
});
