import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

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
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              needsSetup: true,
              authenticated: false,
              sessionExpiry: null,
              authEnabled: true,
            })
          )
      )
    );

    renderWithProviders(
      <AuthProvider>
        <SetupScreen />
      </AuthProvider>
    );

    expect(await screen.findByText('Choose setup path')).toBeDefined();
    expect(screen.getByTestId('setup-mode-board').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('setup-mode-board'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Password' }));

    expect(screen.getByText('Secure Your Board').closest('.desktop-window-drag')).not.toBeNull();
    expect(window.localStorage.getItem(DESKTOP_ONBOARDING_STORAGE_KEY)).toBe('true');
    expect(window.localStorage.getItem(PRODUCT_MODE_PENDING_STORAGE_KEY)).toBe('board-only');
  });

  it('keeps desktop setup draggable while its controls remain interactive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              needsSetup: true,
              authenticated: false,
              sessionExpiry: null,
              authEnabled: true,
            })
          )
      )
    );

    renderWithProviders(
      <AuthProvider>
        <SetupScreen />
      </AuthProvider>
    );

    const heading = await screen.findByText('Choose setup path');
    const setupSurface = heading.closest('.desktop-window-drag');
    const continueButton = screen.getByRole('button', { name: 'Continue to Password' });

    expect(setupSurface).not.toBeNull();
    expect(continueButton.classList.contains('desktop-no-drag')).toBe(true);
  });

  it('defaults a populated desktop database to using existing data without changing its mode', async () => {
    window.localStorage.setItem(DESKTOP_ONBOARDING_STORAGE_KEY, 'true');
    window.localStorage.setItem(PRODUCT_MODE_PENDING_STORAGE_KEY, 'agent-ready');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              needsSetup: true,
              authenticated: false,
              sessionExpiry: null,
              authEnabled: true,
              setupContext: {
                storageMode: 'sqlite',
                hasExistingData: true,
                counts: {
                  tasks: 2236,
                  squadMessages: 74196,
                  telemetryEvents: 98,
                  workflowDefinitions: 2,
                  workflowRuns: 3,
                },
              },
            })
          )
      )
    );

    renderWithProviders(
      <AuthProvider>
        <SetupScreen />
      </AuthProvider>
    );

    expect(await screen.findByText('Use Existing Data')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId('setup-mode-existing').getAttribute('aria-pressed')).toBe('true');
    });
    expect(screen.queryByTestId('setup-mode-board')).toBeNull();
    expect(screen.getByText('2,236 tasks')).toBeDefined();
    expect(screen.getByText('74,196 squad messages')).toBeDefined();
    expect(screen.getByText(/does not import, overwrite, or migrate it again/i)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Secure Existing Data' }));

    expect(screen.getByText('Secure Your Board')).toBeDefined();
    expect(window.localStorage.getItem(DESKTOP_ONBOARDING_STORAGE_KEY)).toBe('true');
    expect(window.localStorage.getItem(PRODUCT_MODE_PENDING_STORAGE_KEY)).toBeNull();
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
