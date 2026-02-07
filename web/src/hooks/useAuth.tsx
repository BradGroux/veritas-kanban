import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';
import { apiFetch } from '@/lib/api/helpers';

// Types
export interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
  sessionExpiry: string | null;
  authEnabled: boolean;
}

export interface AuthContextValue {
  /** Current auth status */
  status: AuthStatus | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Refresh auth status */
  refreshStatus: () => Promise<void>;
  /** Setup password (first time) */
  setup: (password: string) => Promise<{ success: boolean; recoveryKey?: string; error?: string }>;
  /** Login with password */
  login: (password: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  /** Logout */
  logout: () => Promise<void>;
  /** Recover password with recovery key */
  recover: (
    recoveryKey: string,
    newPassword: string
  ) => Promise<{ success: boolean; recoveryKey?: string; error?: string }>;
  /** Change password */
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Auth Provider
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<AuthStatus>('/api/auth/status');
      setStatus(data);
    } catch (err) {
      console.error('[Auth] Failed to check auth status:', err);
      setError(err instanceof Error ? err.message : 'Failed to check auth status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check auth status on mount
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const setup = useCallback(async (password: string) => {
    try {
      const data = await apiFetch<{ success: boolean; recoveryKey: string }>('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      // Don't refresh status here - let SetupScreen show the recovery key first
      // The user will trigger a refresh when they click "Continue to App"
      return { success: true, recoveryKey: data.recoveryKey };
    } catch (err) {
      console.error('[Auth] Setup failed:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Setup failed' };
    }
  }, []);

  const login = useCallback(
    async (password: string, rememberMe = false) => {
      try {
        await apiFetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, rememberMe }),
        });
        await refreshStatus();
        return { success: true };
      } catch (err) {
        console.error('[Auth] Login failed:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Login failed' };
      }
    },
    [refreshStatus]
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      await refreshStatus();
    }
  }, [refreshStatus]);

  const recover = useCallback(
    async (recoveryKey: string, newPassword: string) => {
      try {
        const data = await apiFetch<{ success: boolean; recoveryKey: string }>(
          '/api/auth/recover',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recoveryKey, newPassword }),
          }
        );
        await refreshStatus();
        return { success: true, recoveryKey: data.recoveryKey };
      } catch (err) {
        console.error('[Auth] Recovery failed:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Recovery failed' };
      }
    },
    [refreshStatus]
  );

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      return { success: true };
    } catch (err) {
      console.error('[Auth] Password change failed:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Password change failed',
      };
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        isLoading,
        error,
        refreshStatus,
        setup,
        login,
        logout,
        recover,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Hook to use auth context
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
