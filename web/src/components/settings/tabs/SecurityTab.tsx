import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button, Group, Modal, PasswordInput, Stack, Text } from '@mantine/core';
import { Eye, EyeOff, Check } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { authApi } from '@/lib/api/auth';
import { SettingsPage, SettingsSection } from '../shared';

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
  const [resetOpen, setResetOpen] = useState(false);

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
    <SettingsPage title="Security" description="Manage your password and security settings.">
      <SettingsSection
        title="Change Password"
        description="Choose a strong password and confirm it before saving."
      >
        <div className="space-y-4 max-w-md">
          <div className="space-y-2">
            <PasswordInput
              id="current-password"
              label="Current Password"
              visible={showPasswords}
              onVisibilityChange={setShowPasswords}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              visibilityToggleIcon={({ reveal }) =>
                reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />
              }
            />
          </div>

          <div className="space-y-2">
            <PasswordInput
              id="new-password"
              label="New Password"
              visible={showPasswords}
              onVisibilityChange={setShowPasswords}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (8+ characters)"
              visibilityToggleIcon={({ reveal }) =>
                reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />
              }
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
            <PasswordInput
              id="confirm-new-password"
              label="Confirm New Password"
              visible={showPasswords}
              onVisibilityChange={setShowPasswords}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              visibilityToggleIcon={({ reveal }) =>
                reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />
              }
            />
            {confirmPassword && !passwordsMatch && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>

          <Button
            onClick={handleChangePassword}
            disabled={!canChange || isChanging}
            fullWidth
            leftSection={changeSuccess ? <Check className="w-4 h-4" /> : undefined}
          >
            {isChanging ? 'Changing...' : changeSuccess ? 'Password Changed' : 'Change Password'}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Reset Security Settings"
        description="Clear the password and recovery key, then require first-run setup again."
        tone="danger"
      >
        <div className="p-4 border border-destructive/20 rounded-lg bg-destructive/5 space-y-3">
          <div>
            <p className="font-medium text-sm">Reset Security Settings</p>
            <p className="text-xs text-muted-foreground mt-1">
              This will clear your password and recovery key. You'll need to set up a new password.
              Use the CLI command instead:{' '}
              <code className="bg-muted px-1 rounded">pnpm run reset-password</code>
            </p>
          </div>

          <Button color="red" size="sm" onClick={() => setResetOpen(true)}>
            Reset All Security
          </Button>
          <Modal
            opened={resetOpen}
            onClose={() => setResetOpen(false)}
            title="Reset all security settings?"
            centered
          >
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                This action cannot be undone. Your password and recovery key will be deleted. You'll
                need to set up a new password on the next page load.
              </Text>
              <Group justify="flex-end">
                <Button variant="subtle" color="gray" onClick={() => setResetOpen(false)}>
                  Cancel
                </Button>
                <Button
                  color="red"
                  onClick={async () => {
                    // Call the reset endpoint
                    try {
                      await authApi.reset();
                      window.location.reload();
                    } catch (err) {
                      console.error('[Security] Auth reset failed:', err);
                      toast({
                        title: 'Reset failed',
                        description: 'Please use the CLI command instead.',
                        duration: 5000,
                      });
                    } finally {
                      setResetOpen(false);
                    }
                  }}
                >
                  Reset Everything
                </Button>
              </Group>
            </Stack>
          </Modal>
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
