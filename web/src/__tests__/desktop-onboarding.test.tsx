import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from './test-utils';
import {
  DESKTOP_ONBOARDING_STORAGE_KEY,
  DesktopOnboardingPanel,
} from '@/components/auth/DesktopOnboarding';
import { PRODUCT_MODE_PENDING_STORAGE_KEY } from '@/lib/product-modes';
import { SetupScreen } from '@/components/auth/SetupScreen';
import { AuthProvider } from '@/hooks/useAuth';

function diagnostics() {
  return {
    generatedAt: '2026-05-31T00:00:00.000Z',
    checks: [
      {
        name: 'local-server-health',
        state: 'ok' as const,
        detail: 'ready',
        checkedAt: '2026-05-31T00:00:00.000Z',
      },
    ],
    supportSnapshot: null,
  };
}

describe('desktop onboarding', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    delete (window as Window & { veritasDesktop?: unknown }).veritasDesktop;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the board-only first-run path before password setup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ needsSetup: true })))
    );

    renderWithProviders(
      <AuthProvider>
        <SetupScreen />
      </AuthProvider>
    );

    expect(await screen.findByText('Choose setup path')).toBeDefined();
    fireEvent.click(screen.getByTestId('setup-mode-board'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Password' }));

    expect(screen.getByText('Secure Your Board')).toBeDefined();
    expect(window.localStorage.getItem(DESKTOP_ONBOARDING_STORAGE_KEY)).toBe('true');
    expect(window.localStorage.getItem(PRODUCT_MODE_PENDING_STORAGE_KEY)).toBe('board-only');
  });

  it('validates a remote URL through the desktop bridge', async () => {
    const validateConnectionConfig = vi.fn(async () => ({
      mode: 'remote' as const,
      valid: true,
      normalizedServerUrl: 'https://remote.example/',
      warnings: [],
      errors: [],
    }));
    Object.defineProperty(window, 'veritasDesktop', {
      configurable: true,
      value: {
        getSetupDiagnostics: vi.fn(async () => diagnostics()),
        validateConnectionConfig,
      },
    });

    renderWithProviders(<DesktopOnboardingPanel onContinue={vi.fn()} />);

    fireEvent.click(screen.getByTestId('setup-mode-remote'));
    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: 'https://remote.example' },
    });
    fireEvent.change(screen.getByLabelText('Token'), {
      target: { value: 'vk_pat_secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate Remote' }));

    expect(await screen.findByText('Remote target is reachable.')).toBeDefined();
    expect(validateConnectionConfig).toHaveBeenCalledWith({
      mode: 'remote',
      serverUrl: 'https://remote.example',
      serverToken: 'vk_pat_secret',
      pairingPayload: undefined,
    });
  });

  it('labels browser-only remote checks as URL validation', async () => {
    renderWithProviders(<DesktopOnboardingPanel onContinue={vi.fn()} />);

    fireEvent.click(screen.getByTestId('setup-mode-remote'));
    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: 'https://remote.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate Remote' }));

    expect(await screen.findByText('URL syntax is valid.')).toBeDefined();
    expect(screen.getByText('Live reachability checks require the desktop app.')).toBeDefined();
  });

  it('blocks browser-only remote checks for local destinations', async () => {
    renderWithProviders(<DesktopOnboardingPanel onContinue={vi.fn()} />);

    fireEvent.click(screen.getByTestId('setup-mode-remote'));
    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: 'https://127.0.0.1:3001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate Remote' }));

    expect(
      await screen.findByText('Remote server URL cannot target loopback address.')
    ).toBeDefined();
  });
});
