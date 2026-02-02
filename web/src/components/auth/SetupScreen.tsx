import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, EyeOff, Copy, Download, Check, Shield, Key } from 'lucide-react';

// Password strength calculation
function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' };
  if (score <= 2) return { score, label: 'Fair', color: 'bg-orange-500' };
  if (score <= 3) return { score, label: 'Good', color: 'bg-yellow-500' };
  if (score <= 4) return { score, label: 'Strong', color: 'bg-green-500' };
  return { score, label: 'Very Strong', color: 'bg-emerald-500' };
}

export function SetupScreen() {
  const { setup } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recovery key state
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  const strength = getPasswordStrength(password);
  const passwordsMatch = password === confirmPassword;
  const isValid = password.length >= 8 && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await setup(password);

    if (result.success && result.recoveryKey) {
      setRecoveryKey(result.recoveryKey);
    } else {
      setError(result.error || 'Setup failed');
    }

    setIsSubmitting(false);
  };

  const copyRecoveryKey = async () => {
    if (!recoveryKey) return;
    await navigator.clipboard.writeText(recoveryKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const downloadRecoveryKey = () => {
    if (!recoveryKey) return;
    const blob = new Blob(
      [
        `Veritas Kanban Recovery Key\n\nYour recovery key: ${recoveryKey}\n\nKeep this file safe! You will need it if you forget your password.\n\nGenerated: ${new Date().toISOString()}`,
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

  // Show recovery key screen after successful setup
  if (recoveryKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 mb-4">
              <Key className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold">Save Your Recovery Key</h1>
            <p className="text-muted-foreground">
              This is the only way to recover your account if you forget your password.
            </p>
          </div>

          <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3">
            <div className="font-mono text-xl text-center tracking-wider py-2">{recoveryKey}</div>
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold">Secure Your Board</h1>
          <p className="text-muted-foreground">
            Create a password to protect your Veritas Kanban board.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password (8+ characters)"
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
            {password && (
              <div className="space-y-1">
                <div className="flex gap-1 h-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-full transition-colors ${
                        i <= strength.score ? strength.color : 'bg-muted'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Password strength: <span className="font-medium">{strength.label}</span>
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
            />
            {confirmPassword && !passwordsMatch && (
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
            {isSubmitting ? 'Creating...' : 'Create Password'}
          </Button>
        </form>
      </div>
    </div>
  );
}
