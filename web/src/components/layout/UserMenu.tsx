import { useCallback, useEffect, useState } from 'react';
import { Building2, Clock, ChevronDown, KeyRound, Lock, LogOut, Shield, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" title="Session menu">
          <Lock className="h-4 w-4 text-emerald-500" />
          <span className="text-xs text-muted-foreground hidden sm:inline">{displayName}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="p-3 border-b border-border">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 rounded-full bg-primary/10 p-1.5 text-primary">
              <User className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{displayName}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="capitalize">
                  {role}
                </Badge>
                {authContext?.authMethod && (
                  <Badge variant="outline" className="capitalize">
                    {authContext.authMethod}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatExpiry(status.sessionExpiry)}
          </div>
          {activeWorkspace && (
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <Building2 className="h-3 w-3" />
              <span className="truncate">{activeWorkspace.name}</span>
            </div>
          )}
          {authContext?.tokenName && (
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <KeyRound className="h-3 w-3" />
              <span className="truncate">{authContext.tokenName}</span>
            </div>
          )}
        </div>

        <div className="p-1">
          <button
            onClick={handleIdentityClick}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
          >
            <Building2 className="h-4 w-4" />
            Members & Permissions
            {!canManageMembers && (
              <span className="ml-auto text-xs text-muted-foreground">View</span>
            )}
          </button>

          <button
            onClick={handleSecurityClick}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
          >
            <Shield className="h-4 w-4" />
            Security Settings
          </button>

          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-destructive/10 text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {isLoggingOut ? 'Logging out...' : 'Log Out'}
            <span className="ml-auto text-xs text-muted-foreground">⌘⇧L</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
