import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Eye, EyeOff, Check, AlertTriangle, Key } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

// Password strength calculation (same as SetupScreen)
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

export function SecurityTab() {
  const { changePassword } = useAuth();
  const { toast } = useToast();

  // Change password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [changeSuccess, setChangeSuccess] = useState(false);

  const strength = getPasswordStrength(newPassword);
  const passwordsMatch = newPassword === confirmPassword;
  const canChange = currentPassword.length > 0 && newPassword.length >= 8 && passwordsMatch;

  const handleChangePassword = async () => {
    if (!canChange || isChanging) return;

    setIsChanging(true);
    const result = await changePassword(currentPassword, newPassword);
    setIsChanging(false);

    if (result.success) {
      setChangeSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({
        title: 'Password changed',
        description: 'Your password has been updated successfully.',
        duration: 3000,
      });
      setTimeout(() => setChangeSuccess(false), 3000);
    } else {
      toast({
        title: 'Failed to change password',
        description: result.error || 'Please check your current password and try again.',
        duration: 5000,
      });
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-1">Security</h3>
        <p className="text-sm text-muted-foreground">Manage your password and security settings.</p>
      </div>

      {/* Change Password Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-muted-foreground" />
          <h4 className="font-medium">Change Password</h4>
        </div>

        <div className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showPasswords ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPasswords(!showPasswords)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (8+ characters)"
            />
            {newPassword && (
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
                  Strength: <span className="font-medium">{strength.label}</span>
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">Confirm New Password</Label>
            <Input
              id="confirm-new-password"
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
            />
            {confirmPassword && !passwordsMatch && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>

          <Button
            onClick={handleChangePassword}
            disabled={!canChange || isChanging}
            className="w-full"
          >
            {isChanging ? (
              'Changing...'
            ) : changeSuccess ? (
              <>
                <Check className="w-4 h-4 mr-2" />
                Password Changed
              </>
            ) : (
              'Change Password'
            )}
          </Button>
        </div>
      </section>

      {/* Danger Zone */}
      <section className="space-y-4 pt-4 border-t border-destructive/20">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <h4 className="font-medium">Danger Zone</h4>
        </div>

        <div className="p-4 border border-destructive/20 rounded-lg bg-destructive/5 space-y-3">
          <div>
            <p className="font-medium text-sm">Reset Security Settings</p>
            <p className="text-xs text-muted-foreground mt-1">
              This will clear your password and recovery key. You'll need to set up a new password.
              Use the CLI command instead:{' '}
              <code className="bg-muted px-1 rounded">pnpm run reset-password</code>
            </p>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                Reset All Security
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset all security settings?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. Your password and recovery key will be deleted.
                  You'll need to set up a new password on the next page load.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={async () => {
                    // Call the reset endpoint
                    try {
                      const res = await fetch('/api/auth/reset', { method: 'POST' });
                      if (res.ok) {
                        window.location.reload();
                      } else {
                        toast({
                          title: 'Reset failed',
                          description: 'Please use the CLI command instead.',
                          duration: 5000,
                        });
                      }
                    } catch (err) {
                      console.error('[Security] Auth reset failed:', err);
                      toast({
                        title: 'Reset failed',
                        description: 'Please use the CLI command instead.',
                        duration: 5000,
                      });
                    }
                  }}
                >
                  Reset Everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
    </div>
  );
}
