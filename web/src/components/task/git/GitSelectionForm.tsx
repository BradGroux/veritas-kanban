import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useConfig, useRepoBranches } from '@/hooks/useConfig';
import { Loader2, FolderGit2 } from 'lucide-react';
import type { Task, TaskGit } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';

interface GitSelectionFormProps {
  task: Task;
  onGitChange: (git: Partial<TaskGit> | undefined) => void;
  disabled?: boolean;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function GitSelectionForm({ task, onGitChange, disabled = false }: GitSelectionFormProps) {
  const { data: config } = useConfig();
  const [selectedRepo, setSelectedRepo] = useState<string>(task.git?.repo || '');
  const [baseBranch, setBaseBranch] = useState<string>(task.git?.baseBranch || '');
  const [featureBranch, setFeatureBranch] = useState<string>(task.git?.branch || '');
  const [autoGenerateBranch, setAutoGenerateBranch] = useState(!task.git?.branch);

  const { data: branches, isLoading: branchesLoading } = useRepoBranches(selectedRepo || undefined);

  // Get the repo config for the selected repo
  const repoConfig = useMemo(() => {
    return config?.repos.find((r) => r.name === selectedRepo);
  }, [config, selectedRepo]);

  // Auto-generate feature branch name from task title
  useEffect(() => {
    if (autoGenerateBranch && task.title) {
      const slug = slugify(task.title);
      setFeatureBranch(`feature/${slug}`);
    }
  }, [task.title, autoGenerateBranch]);

  // Set default base branch when repo changes
  useEffect(() => {
    if (repoConfig && !baseBranch) {
      setBaseBranch(repoConfig.defaultBranch);
    }
  }, [repoConfig, baseBranch]);

  // Sync from task.git when it changes
  useEffect(() => {
    if (task.git) {
      setSelectedRepo(task.git.repo || '');
      setBaseBranch(task.git.baseBranch || '');
      setFeatureBranch(task.git.branch || '');
      setAutoGenerateBranch(!task.git.branch);
    }
  }, [task.id, task.git]); // Re-sync when task or git config changes

  // Update parent when values change
  const handleRepoChange = (repo: string) => {
    setSelectedRepo(repo);
    const newRepoConfig = config?.repos.find((r) => r.name === repo);
    const newBaseBranch = newRepoConfig?.defaultBranch || 'main';
    setBaseBranch(newBaseBranch);

    onGitChange({
      repo,
      baseBranch: newBaseBranch,
      branch: featureBranch,
    });
  };

  const handleBaseBranchChange = (branch: string) => {
    setBaseBranch(branch);
    onGitChange({
      repo: selectedRepo,
      baseBranch: branch,
      branch: featureBranch,
    });
  };

  const handleFeatureBranchChange = (branch: string) => {
    setFeatureBranch(branch);
    setAutoGenerateBranch(false);
    onGitChange({
      repo: selectedRepo,
      baseBranch,
      branch,
    });
  };

  // Don't allow editing if worktree exists
  const isLocked = !!task.git?.worktreePath || disabled;

  return (
    <div className="grid gap-3 p-3 rounded-md border bg-muted/30">
      {/* Repository Selection */}
      <div className="grid gap-1.5">
        <Label className="text-xs">Repository</Label>
        <Select value={selectedRepo} onValueChange={handleRepoChange} disabled={isLocked}>
          <SelectTrigger className={cn(isLocked && 'opacity-60')}>
            <SelectValue placeholder="Select repository..." />
          </SelectTrigger>
          <SelectContent>
            {config?.repos.map((repo) => (
              <SelectItem key={repo.name} value={repo.name}>
                <div className="flex items-center gap-2">
                  <FolderGit2 className="h-3 w-3" />
                  {repo.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedRepo && (
        <>
          {/* Base Branch */}
          <div className="grid gap-1.5">
            <Label className="text-xs">Base Branch</Label>
            {branchesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground h-9 px-3">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading branches...
              </div>
            ) : (
              <Select value={baseBranch} onValueChange={handleBaseBranchChange} disabled={isLocked}>
                <SelectTrigger className={cn(isLocked && 'opacity-60')}>
                  <SelectValue placeholder="Select base branch..." />
                </SelectTrigger>
                <SelectContent>
                  {branches?.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Feature Branch */}
          <div className="grid gap-1.5">
            <Label className="text-xs">Feature Branch</Label>
            <Input
              value={featureBranch}
              onChange={(e) => handleFeatureBranchChange(e.target.value)}
              placeholder="feature/my-feature"
              disabled={isLocked}
              className={cn(isLocked && 'opacity-60')}
            />
            {autoGenerateBranch && featureBranch && !isLocked && (
              <p className="text-xs text-muted-foreground">Auto-generated from task title</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
