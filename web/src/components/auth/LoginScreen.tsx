import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, EyeOff, Lock, Key, Check, Copy, Download } from 'lucide-react';

export function LoginScreen() {
  const { login, recover } = useAuth();
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recovery mode state
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // New recovery key display
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await login(password, rememberMe);

    if (!result.success) {
      setError(result.error || 'Invalid password');
    }

    setIsSubmitting(false);
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryKey || !newPassword || newPassword !== confirmNewPassword || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await recover(recoveryKey, newPassword);

    if (result.success && result.recoveryKey) {
      setNewRecoveryKey(result.recoveryKey);
    } else {
      setError(result.error || 'Recovery failed');
    }

    setIsSubmitting(false);
  };

  const copyRecoveryKey = async () => {
    if (!newRecoveryKey) return;
    await navigator.clipboard.writeText(newRecoveryKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const downloadRecoveryKey = () => {
    if (!newRecoveryKey) return;
    const blob = new Blob(
      [
        `Veritas Kanban Recovery Key\n\nYour recovery key: ${newRecoveryKey}\n\nKeep this file safe! You will need it if you forget your password.\n\nGenerated: ${new Date().toISOString()}`,
      ],
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'veritas-kanban-recovery-key.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Show new recovery key after successful password reset
  if (newRecoveryKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 mb-4">
              <Key className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold">Password Reset Complete</h1>
            <p className="text-muted-foreground">
              Save your new recovery key - you'll need it if you forget your password again.
            </p>
          </div>

          <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3">
            <div className="font-mono text-xl text-center tracking-wider py-2">
              {newRecoveryKey}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={copyRecoveryKey}>
                {copiedKey ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {copiedKey ? 'Copied!' : 'Copy'}
              </Button>
              <Button variant="outline" className="flex-1" onClick={downloadRecoveryKey}>
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            </div>
          </div>

          <div className="flex items-start space-x-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <Checkbox
              id="saved-confirm"
              checked={savedConfirmed}
              onCheckedChange={(checked) => setSavedConfirmed(!!checked)}
            />
            <Label htmlFor="saved-confirm" className="text-sm cursor-pointer">
              I have saved my recovery key in a safe place
            </Label>
          </div>

          <Button
            className="w-full"
            disabled={!savedConfirmed}
            onClick={() => window.location.reload()}
          >
            Continue to App
          </Button>
        </div>
      </div>
    );
  }

  // Recovery mode
  if (showRecovery) {
    const passwordsMatch = newPassword === confirmNewPassword;
    const isValid = recoveryKey && newPassword.length >= 8 && passwordsMatch;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/10 text-amber-500 mb-4">
              <Key className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold">Reset Password</h1>
            <p className="text-muted-foreground">Enter your recovery key and a new password.</p>
          </div>

          <form onSubmit={handleRecover} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recovery-key">Recovery Key</Label>
              <Input
                id="recovery-key"
                type="text"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                className="font-mono tracking-wider"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (8+ characters)"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-new-password">Confirm New Password</Label>
              <Input
                id="confirm-new-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm new password"
              />
              {confirmNewPassword && !passwordsMatch && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive"
              >
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={!isValid || isSubmitting}>
              {isSubmitting ? 'Resetting...' : 'Reset Password'}
            </Button>

            <button
              type="button"
              onClick={() => {
                setShowRecovery(false);
                setError(null);
              }}
              className="w-full text-sm text-muted-foreground hover:text-foreground"
            >
              Back to login
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Login form
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold">Welcome Back</h1>
          <p className="text-muted-foreground">Enter your password to access Veritas Kanban.</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Eye className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="remember-me"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(!!checked)}
            />
            <Label htmlFor="remember-me" className="text-sm cursor-pointer">
              Remember me for 30 days
            </Label>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={!password || isSubmitting}>
            {isSubmitting ? 'Logging in...' : 'Login'}
          </Button>

          <button
            type="button"
            onClick={() => {
              setShowRecovery(true);
              setError(null);
            }}
            className="w-full text-sm text-muted-foreground hover:text-foreground"
          >
            Forgot password?
          </button>
        </form>
      </div>
    </div>
  );
}
