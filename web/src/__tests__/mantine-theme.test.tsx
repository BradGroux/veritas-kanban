import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function PreferenceProbe() {
  const { theme, preference, setTheme } = useTheme();
  return (
    <>
      <output data-testid="resolved">{theme}</output>
      <output data-testid="preference">{preference}</output>
      {(['system', 'light', 'dark'] as const).map((value) => (
        <button key={value} onClick={() => setTheme(value)}>
          {value}
        </button>
      ))}
    </>
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
      writable: true,
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

  it('follows live system changes only for System and persists explicit overrides across remounts', async () => {
    let dark = false;
    const listeners = new Map<string, Set<(event: { matches: boolean }) => void>>();
    window.matchMedia = vi.fn((query: string) => {
      const callbacks = listeners.get(query) ?? new Set();
      listeners.set(query, callbacks);
      return {
        media: query,
        get matches() {
          return query === '(prefers-color-scheme: dark)' ? dark : !dark;
        },
        addEventListener: (_type: string, callback: (event: { matches: boolean }) => void) =>
          callbacks.add(callback),
        removeEventListener: (_type: string, callback: (event: { matches: boolean }) => void) =>
          callbacks.delete(callback),
      } as unknown as MediaQueryList;
    });
    const changeSystem = (value: boolean) =>
      act(() => {
        dark = value;
        for (const [query, callbacks] of listeners)
          for (const callback of callbacks)
            callback({ matches: query === '(prefers-color-scheme: dark)' ? dark : !dark });
      });
    window.localStorage.setItem('veritas-kanban-theme', 'light');
    let view = render(
      <MantineRoot>
        <PreferenceProbe />
      </MantineRoot>
    );
    await waitFor(() => expect(screen.getByTestId('preference').textContent).toBe('light'));
    changeSystem(true);
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'system' }));
    await waitFor(() => expect(screen.getByTestId('resolved').textContent).toBe('dark'));
    expect(window.localStorage.getItem('veritas-kanban-theme')).toBe('auto');
    changeSystem(false);
    await waitFor(() => expect(document.documentElement.dataset.mantineColorScheme).toBe('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    view.unmount();
    view = render(
      <MantineRoot>
        <PreferenceProbe />
      </MantineRoot>
    );
    await waitFor(() => expect(screen.getByTestId('preference').textContent).toBe('system'));
    changeSystem(true);
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    changeSystem(false);
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    view.unmount();
    render(
      <MantineRoot>
        <PreferenceProbe />
      </MantineRoot>
    );
    await waitFor(() => expect(screen.getByTestId('preference').textContent).toBe('dark'));
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
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
