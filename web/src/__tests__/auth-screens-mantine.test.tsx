import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LoginScreen } from '@/components/auth/LoginScreen';
import { DESKTOP_ONBOARDING_STORAGE_KEY } from '@/components/auth/DesktopOnboarding';
import { SetupScreen } from '@/components/auth/SetupScreen';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  setup: vi.fn(),
  login: vi.fn(),
  recover: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    setup: mocks.setup,
    login: mocks.login,
    recover: mocks.recover,
  }),
}));

function ensureLocalStorage() {
  if (window.localStorage) return;

  const storage = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return storage.size;
      },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
}

describe('auth screens Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureLocalStorage();
    window.localStorage.setItem(DESKTOP_ONBOARDING_STORAGE_KEY, 'true');
    mocks.setup.mockResolvedValue({ success: true, recoveryKey: 'AAAA-BBBB-CCCC-DDDD' });
    mocks.login.mockResolvedValue({ success: true });
    mocks.recover.mockResolvedValue({ success: true, recoveryKey: 'EEEE-FFFF-GGGG-HHHH' });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('keeps links and labels clickable inside desktop drag surfaces', () => {
    const globalStyles = readFileSync(resolve(process.cwd(), 'src/globals.css'), 'utf8');

    expect(globalStyles).toContain("html[data-client='desktop'] a,");
    expect(globalStyles).toContain("html[data-client='desktop'] label,");
    expect(globalStyles).toContain("html[data-client='desktop'] [contenteditable='true'],");
  });

  it('renders setup password and recovery controls through direct Mantine primitives', async () => {
    const { container } = renderWithProviders(<SetupScreen />);

    expect(screen.getByText('Secure Your Board')).toBeDefined();
    expect(screen.getByText('Secure Your Board').closest('.desktop-window-drag')).not.toBeNull();
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.getByLabelText('Confirm Password')).toBeDefined();
    expect(container.querySelectorAll('.mantine-PasswordInput-root')).toHaveLength(2);
    expect(container.querySelectorAll('.mantine-Button-root')).toHaveLength(1);
    expect(container.querySelector('[data-slot="button"]')).toBeNull();
    expect(container.querySelector('[data-slot="checkbox"]')).toBeNull();

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'StrongPass1!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'StrongPass1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Password' }));

    await waitFor(() => expect(mocks.setup).toHaveBeenCalledWith('StrongPass1!'));
    expect(await screen.findByText('Save Your Recovery Key')).toBeDefined();
    expect(
      screen.getByText('Save Your Recovery Key').closest('.desktop-window-drag')
    ).not.toBeNull();
    expect(screen.getByText('AAAA-BBBB-CCCC-DDDD')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Checkbox-root')).toHaveLength(1);
    expect(container.querySelectorAll('.mantine-Button-root')).toHaveLength(3);
    expect(container.querySelector('[data-slot="button"]')).toBeNull();
    expect(container.querySelector('[data-slot="checkbox"]')).toBeNull();
  });

  it('renders login controls through direct Mantine primitives and submits remember-me state', async () => {
    const { container } = renderWithProviders(<LoginScreen />);

    expect(screen.getByText('Welcome Back')).toBeDefined();
    expect(screen.getByText('Welcome Back').closest('.desktop-window-drag')).not.toBeNull();
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.getByLabelText('Remember me for 30 days')).toBeDefined();
    expect(container.querySelectorAll('.mantine-PasswordInput-root')).toHaveLength(1);
    expect(container.querySelectorAll('.mantine-Checkbox-root')).toHaveLength(1);
    expect(container.querySelectorAll('.mantine-Button-root')).toHaveLength(2);
    expect(container.querySelector('[data-slot="button"]')).toBeNull();
    expect(container.querySelector('[data-slot="checkbox"]')).toBeNull();

    const loginButton = screen.getByRole('button', { name: 'Login' });
    const forgotPasswordButton = screen.getByRole('button', { name: 'Forgot password?' });
    expect(loginButton.getAttribute('data-block')).toBe('true');
    expect(forgotPasswordButton.getAttribute('data-block')).toBe('true');
    expect(loginButton.parentElement).toBe(forgotPasswordButton.parentElement);
    expect(loginButton.parentElement?.classList.contains('mantine-Stack-root')).toBe(true);

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'StrongPass1!' },
    });
    fireEvent.click(screen.getByLabelText('Remember me for 30 days'));
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith('StrongPass1!', true));
  });

  it('renders recovery controls through direct Mantine primitives and submits uppercase key', async () => {
    const { container } = renderWithProviders(<LoginScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.getByRole('heading', { name: 'Reset Password' })).toBeDefined();
    expect(
      screen.getByRole('heading', { name: 'Reset Password' }).closest('.desktop-window-drag')
    ).not.toBeNull();
    expect(screen.getByLabelText('Recovery Key')).toBeDefined();
    expect(screen.getByLabelText('New Password')).toBeDefined();
    expect(screen.getByLabelText('Confirm New Password')).toBeDefined();
    expect(container.querySelectorAll('.mantine-TextInput-root')).toHaveLength(1);
    expect(container.querySelectorAll('.mantine-PasswordInput-root')).toHaveLength(2);
    expect(container.querySelectorAll('.mantine-Button-root')).toHaveLength(2);
    expect(container.querySelector('[data-slot="button"]')).toBeNull();
    expect(container.querySelector('[data-slot="input"]')).toBeNull();

    const resetPasswordButton = screen.getByRole('button', { name: 'Reset Password' });
    const backToLoginButton = screen.getByRole('button', { name: 'Back to login' });

    expect(resetPasswordButton.getAttribute('data-block')).toBe('true');
    expect(backToLoginButton.getAttribute('data-block')).toBe('true');
    expect(resetPasswordButton.parentElement).toBe(backToLoginButton.parentElement);
    expect(resetPasswordButton.parentElement?.classList.contains('mantine-Stack-root')).toBe(true);
    expect(screen.getByLabelText('New Password').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText('Confirm New Password').getAttribute('autocomplete')).toBe(
      'new-password'
    );

    fireEvent.change(screen.getByLabelText('Recovery Key'), {
      target: { value: 'abcd-efgh-1234-5678' },
    });
    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'NewStrongPass1!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), {
      target: { value: 'NewStrongPass1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

    await waitFor(() =>
      expect(mocks.recover).toHaveBeenCalledWith('ABCD-EFGH-1234-5678', 'NewStrongPass1!')
    );
  });

  it('associates setup guidance and announces one failure until the field changes', async () => {
    mocks.setup.mockResolvedValue({ success: false, error: 'Setup could not be completed' });
    renderWithProviders(<SetupScreen />);

    const password = screen.getByLabelText('Password');
    const confirmation = screen.getByLabelText('Confirm Password');
    fireEvent.change(password, { target: { value: 'StrongPass1!' } });
    expect(password.getAttribute('aria-describedby')).toBe('setup-password-strength');
    expect(screen.getByText(/Password strength:/).getAttribute('aria-live')).toBeNull();

    fireEvent.change(confirmation, { target: { value: 'different' } });
    expect(confirmation.getAttribute('aria-invalid')).toBe('true');
    expect(confirmation.getAttribute('aria-describedby')).toBe('setup-password-mismatch');
    fireEvent.change(confirmation, { target: { value: 'StrongPass1!' } });
    expect(confirmation.getAttribute('aria-invalid')).toBeNull();
    expect(confirmation.getAttribute('aria-describedby')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create Password' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Setup could not be completed');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('aria-describedby')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['setup-password-strength', 'setup-submission-error'])
    );

    fireEvent.change(password, { target: { value: 'ChangedPass1!' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(password.getAttribute('aria-invalid')).toBeNull();
    expect(password.getAttribute('aria-describedby')).toBe('setup-password-strength');
  });

  it('announces a login failure once and clears stale field semantics on correction', async () => {
    mocks.login.mockResolvedValue({ success: false, error: 'Invalid password' });
    renderWithProviders(<LoginScreen />);

    const password = screen.getByLabelText('Password');
    fireEvent.change(password, { target: { value: 'WrongPass1!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Invalid password');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('aria-describedby')).toBe('login-submission-error');

    fireEvent.change(password, { target: { value: 'CorrectedPass1!' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(password.getAttribute('aria-invalid')).toBeNull();
    expect(password.getAttribute('aria-describedby')).toBeNull();
  });

  it('associates recovery mismatch and server failure without moving focus to the alert', async () => {
    mocks.recover.mockResolvedValue({ success: false, error: 'Recovery failed' });
    renderWithProviders(<LoginScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    const recoveryKey = screen.getByLabelText('Recovery Key');
    const newPassword = screen.getByLabelText('New Password');
    const confirmation = screen.getByLabelText('Confirm New Password');
    fireEvent.change(recoveryKey, { target: { value: 'abcd-efgh-1234-5678' } });
    fireEvent.change(newPassword, { target: { value: 'NewStrongPass1!' } });
    fireEvent.change(confirmation, { target: { value: 'different' } });
    expect(confirmation.getAttribute('aria-invalid')).toBe('true');
    expect(confirmation.getAttribute('aria-describedby')).toBe('recovery-password-mismatch');

    fireEvent.change(confirmation, { target: { value: 'NewStrongPass1!' } });
    expect(confirmation.getAttribute('aria-invalid')).toBeNull();
    expect(confirmation.getAttribute('aria-describedby')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Recovery failed');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(document.activeElement).not.toBe(alert);
    expect(recoveryKey.getAttribute('aria-invalid')).toBe('true');
    expect(recoveryKey.getAttribute('aria-describedby')).toBe('recovery-submission-error');

    fireEvent.change(recoveryKey, { target: { value: 'WXYZ-EFGH-1234-5678' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(recoveryKey.getAttribute('aria-invalid')).toBeNull();
    expect(recoveryKey.getAttribute('aria-describedby')).toBeNull();
  });
});
