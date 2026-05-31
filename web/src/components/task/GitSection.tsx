import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useConfig } from '@/hooks/useConfig';
import { GitBranch, Loader2, AlertCircle } from 'lucide-react';
import type { Task, TaskGit } from '@veritas-kanban/shared';
import { GitSelectionForm } from './git/GitSelectionForm';
import { WorktreeStatus } from './git/WorktreeStatus';
import { useIdentity } from '@/hooks/useIdentity';

interface GitSectionProps {
  task: Task;
  onGitChange: (git: Partial<TaskGit> | undefined) => void;
}

export function GitSection({ task, onGitChange }: GitSectionProps) {
  const { data: config, isLoading: configLoading } = useConfig();
  const { hasPermission } = useIdentity();
  const canEditTaskGit = hasPermission('task:write');

  const handleClearGit = () => {
    onGitChange(undefined);
  };

  // Don't allow editing if worktree exists
  const isLocked = !!task.git?.worktreePath || !canEditTaskGit;
  const selectedRepo = task.git?.repo;

  if (configLoading) {
    return (
      <div className="space-y-2">
        <Label className="text-muted-foreground flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          Git Integration
        </Label>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  if (!config?.repos.length) {
    return (
      <div className="space-y-2">
        <Label className="text-muted-foreground flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          Git Integration
        </Label>
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 rounded-md border border-dashed">
          <AlertCircle className="h-4 w-4" />
          No repositories configured. Add one in Settings.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          Git Integration
        </Label>
        {selectedRepo && !isLocked && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={handleClearGit}
            disabled={!canEditTaskGit}
          >
            Clear
          </Button>
        )}
      </div>

      {!canEditTaskGit && (
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Task write permission is required to change Git settings.
        </div>
      )}
      <GitSelectionForm task={task} onGitChange={onGitChange} disabled={!canEditTaskGit} />
      <WorktreeStatus task={task} />
    </div>
  );
}
