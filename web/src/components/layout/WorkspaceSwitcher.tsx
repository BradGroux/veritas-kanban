import { useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useIdentity } from '@/hooks/useIdentity';

export function WorkspaceSwitcher() {
  const { activeWorkspace, activeMembership, activeWorkspaceId, workspaces, switchWorkspace } =
    useIdentity();
  const [isSwitching, setIsSwitching] = useState(false);

  if (workspaces.length === 0) {
    return (
      <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
        <Building2 className="h-4 w-4" aria-hidden="true" />
        Workspace unavailable
      </div>
    );
  }

  const handleSwitch = async (workspaceId: string) => {
    if (workspaceId === activeWorkspaceId) return;
    setIsSwitching(true);
    try {
      await switchWorkspace(workspaceId);
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <div className="hidden md:flex items-center gap-2">
      <Select value={activeWorkspaceId ?? undefined} onValueChange={handleSwitch}>
        <SelectTrigger
          className="h-8 w-[190px] bg-background/60"
          aria-label="Workspace"
          disabled={isSwitching}
        >
          <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <SelectValue placeholder={activeWorkspace?.name ?? 'Workspace'} />
          {isSwitching && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
        </SelectTrigger>
        <SelectContent align="start">
          {workspaces.map(({ workspace, membership }) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{workspace.name}</span>
                <span className="text-xs text-muted-foreground">{membership.role}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {activeMembership && (
        <Badge variant="secondary" className="hidden lg:inline-flex capitalize">
          {activeMembership.role}
        </Badge>
      )}
    </div>
  );
}
