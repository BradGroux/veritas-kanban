import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  auth: {
    status: null,
    isLoading: true,
    error: null,
    refreshStatus: vi.fn(),
  } as {
    status: null;
    isLoading: boolean;
    error: string | null;
    refreshStatus: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mocks.auth,
}));

describe('AuthGuard desktop surfaces', () => {
  afterEach(() => {
    cleanup();
    mocks.auth.status = null;
    mocks.auth.isLoading = true;
    mocks.auth.error = null;
    mocks.auth.refreshStatus.mockReset();
  });

  it('keeps the loading surface draggable', () => {
    renderWithProviders(
      <AuthGuard>
        <div>Board</div>
      </AuthGuard>
    );

    expect(screen.getByText('Loading...').closest('.desktop-window-drag')).not.toBeNull();
  });

  it('keeps the connection-error surface draggable and its retry action clickable', () => {
    mocks.auth.isLoading = false;
    mocks.auth.error = 'Local server is unavailable.';

    renderWithProviders(
      <AuthGuard>
        <div>Board</div>
      </AuthGuard>
    );

    expect(screen.getByText('Connection Error').closest('.desktop-window-drag')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.auth.refreshStatus).toHaveBeenCalledOnce();
  });
});
