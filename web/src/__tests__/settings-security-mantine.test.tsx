import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { SecurityTab } from '@/components/settings/tabs/SecurityTab';
import { SettingsErrorBoundary } from '@/components/settings/shared/SettingsErrorBoundary';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    changePassword: mocks.changePassword,
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    toast: mocks.toast,
  }),
}));

describe('Security settings Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.changePassword.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders password controls through direct Mantine primitives and changes passwords', async () => {
    const { container } = renderWithProviders(<SecurityTab />);

    expect(screen.getByLabelText('Current Password')).toBeDefined();
    expect(screen.getByLabelText('New Password')).toBeDefined();
    expect(screen.getByLabelText('Confirm New Password')).toBeDefined();
    expect(container.querySelectorAll('.mantine-PasswordInput-root')).toHaveLength(3);
    expect(container.querySelectorAll('.mantine-Button-root').length).toBeGreaterThanOrEqual(2);

    fireEvent.change(screen.getByLabelText('Current Password'), {
      target: { value: 'current-pass' },
    });
    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'New-Password-123!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), {
      target: { value: 'New-Password-123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(mocks.changePassword).toHaveBeenCalledWith('current-pass', 'New-Password-123!');
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Password changed' })
    );
  });

  it('renders the settings error fallback through Mantine buttons', () => {
    let shouldThrow = true;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    function FlakySettingsSection() {
      if (shouldThrow) throw new Error('settings exploded');
      return <div>Recovered settings</div>;
    }

    const { container } = renderWithProviders(
      <SettingsErrorBoundary tabName="Security">
        <FlakySettingsSection />
      </SettingsErrorBoundary>
    );

    expect(screen.getByText('This section failed to load')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Button-root')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Show error details' }));

    expect(screen.getAllByText(/settings exploded/).length).toBeGreaterThanOrEqual(1);

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(screen.getByText('Recovered settings')).toBeDefined();
    consoleError.mockRestore();
  });
});
