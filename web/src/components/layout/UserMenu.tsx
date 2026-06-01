import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Group,
  Kbd,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { Building2, Clock, ChevronDown, KeyRound, Lock, LogOut, Shield, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useIdentity } from '@/hooks/useIdentity';

interface UserMenuProps {
  onOpenSecuritySettings?: () => void;
  onOpenIdentitySettings?: () => void;
}

export function UserMenu({ onOpenSecuritySettings, onOpenIdentitySettings }: UserMenuProps) {
  const { status, logout } = useAuth();
  const { activeMembership, activeWorkspace, authContext, profile, canManageMembers } =
    useIdentity();
  const [open, setOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Format session expiry
  const formatExpiry = (expiry: string | null) => {
    if (!expiry) return 'No expiry';

    const expiryDate = new Date(expiry);
    const now = new Date();
    const diffMs = expiryDate.getTime() - now.getTime();

    if (diffMs <= 0) return 'Expired';

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d ${diffHours % 24}h remaining`;
    }
    if (diffHours > 0) {
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      return `${diffHours}h ${diffMins}m remaining`;
    }

    const diffMins = Math.floor(diffMs / (1000 * 60));
    return `${diffMins}m remaining`;
  };

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    await logout();
    setOpen(false);
    // Page will redirect via AuthGuard
  }, [logout]);

  // Keyboard shortcut: Cmd/Ctrl+Shift+L for logout
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void handleLogout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleLogout]);

  const handleSecurityClick = () => {
    setOpen(false);
    onOpenSecuritySettings?.();
  };

  const handleIdentityClick = () => {
    setOpen(false);
    onOpenIdentitySettings?.();
  };

  // Don't render if not authenticated
  if (!status?.authenticated) {
    return null;
  }

  const displayName = profile?.user.displayName ?? authContext?.keyName ?? 'Local user';
  const role = activeMembership?.role ?? authContext?.role ?? 'admin';

  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="bottom-end"
      offset={4}
      radius="md"
      shadow="md"
      withinPortal
    >
      <Popover.Target>
        <Button
          variant="subtle"
          color="gray"
          size="sm"
          aria-label="Session menu"
          leftSection={<Lock className="h-4 w-4 text-emerald-500" aria-hidden="true" />}
          rightSection={
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          }
          title="Session menu"
          className="min-h-8"
          onClick={() => setOpen((current) => !current)}
        >
          <Text span size="xs" c="dimmed" className="hidden sm:inline">
            {displayName}
          </Text>
        </Button>
      </Popover.Target>
      <Popover.Dropdown className="w-72 bg-popover p-0 text-popover-foreground">
        <Box className="border-b border-border p-3">
          <Group align="flex-start" gap="xs" wrap="nowrap">
            <Box className="mt-0.5 rounded-full bg-primary/10 p-1.5 text-primary">
              <User className="h-4 w-4" aria-hidden="true" />
            </Box>
            <Box className="min-w-0 flex-1">
              <Text size="sm" fw={500} truncate>
                {displayName}
              </Text>
              <Group mt={4} gap={6} wrap="wrap">
                <Badge variant="light" color="gray" size="xs" className="capitalize">
                  {role}
                </Badge>
                {authContext?.authMethod && (
                  <Badge variant="outline" color="gray" size="xs" className="capitalize">
                    {authContext.authMethod}
                  </Badge>
                )}
              </Group>
            </Box>
          </Group>
          <Group gap="xs" mt="sm" wrap="nowrap" className="text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatExpiry(status.sessionExpiry)}
          </Group>
          {activeWorkspace && (
            <Group gap="xs" mt={4} wrap="nowrap" className="text-xs text-muted-foreground">
              <Building2 className="h-3 w-3" />
              <Text span size="xs" c="dimmed" truncate>
                {activeWorkspace.name}
              </Text>
            </Group>
          )}
          {authContext?.tokenName && (
            <Group gap="xs" mt={4} wrap="nowrap" className="text-xs text-muted-foreground">
              <KeyRound className="h-3 w-3" />
              <Text span size="xs" c="dimmed" truncate>
                {authContext.tokenName}
              </Text>
            </Group>
          )}
        </Box>

        <Stack gap={2} p={4}>
          <UnstyledButton
            onClick={handleIdentityClick}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
          >
            <Building2 className="h-4 w-4" />
            Members & Permissions
            {!canManageMembers && (
              <span className="ml-auto text-xs text-muted-foreground">View</span>
            )}
          </UnstyledButton>

          <UnstyledButton
            onClick={handleSecurityClick}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
          >
            <Shield className="h-4 w-4" />
            Security Settings
          </UnstyledButton>

          <UnstyledButton
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-destructive/10 text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {isLoggingOut ? 'Logging out...' : 'Log Out'}
            <Kbd className="ml-auto text-[10px] text-muted-foreground">⌘⇧L</Kbd>
          </UnstyledButton>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
