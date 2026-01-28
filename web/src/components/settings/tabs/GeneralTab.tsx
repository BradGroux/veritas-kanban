import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  useConfig,
  useAddRepo,
  useRemoveRepo,
  useValidateRepoPath,
  useSetDefaultAgent,
} from '@/hooks/useConfig';
import { Plus, Trash2, Check, X, Loader2, FolderGit2, Bot, Star } from 'lucide-react';
import type { RepoConfig, AgentConfig } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';

export function GeneralTab() {
  const { data: config, isLoading } = useConfig();
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <div className="space-y-6">
      {/* Repositories */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Git Repositories</h3>
          {!showAddForm && (
            <Button variant="outline" size="sm" onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Repo
            </Button>
          )}
        </div>
        {showAddForm && <AddRepoForm onClose={() => setShowAddForm(false)} />}
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : config?.repos.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border rounded-md border-dashed">
            No repositories configured.
          </div>
        ) : (
          <div className="space-y-2">
            {config?.repos.map((repo) => (
              <RepoItem key={repo.name} repo={repo} />
            ))}
          </div>
        )}
      </div>

      {/* Default Agent */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Default Agent</h3>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-2">
            {config?.agents
              .filter((a) => a.enabled)
              .map((agent) => (
                <AgentDefaultItem
                  key={agent.type}
                  agent={agent}
                  isDefault={config.defaultAgent === agent.type}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentDefaultItem({ agent, isDefault }: { agent: AgentConfig; isDefault: boolean }) {
  const setDefaultAgent = useSetDefaultAgent();
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md border bg-card">
      <div className="flex items-center gap-3">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{agent.name}</span>
      </div>
      <Button
        variant={isDefault ? 'default' : 'ghost'}
        size="sm"
        className="h-7"
        onClick={() => setDefaultAgent.mutate(agent.type)}
        disabled={isDefault}
      >
        <Star className={cn('h-3 w-3 mr-1', isDefault && 'fill-current')} />
        {isDefault ? 'Default' : 'Set Default'}
      </Button>
    </div>
  );
}

function AddRepoForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [branches, setBranches] = useState<string[]>([]);
  const [pathValid, setPathValid] = useState<boolean | null>(null);
  const addRepo = useAddRepo();
  const validatePath = useValidateRepoPath();

  const handleValidatePath = async () => {
    if (!path) return;
    try {
      const result = await validatePath.mutateAsync(path);
      setPathValid(result.valid);
      setBranches(result.branches);
      if (result.branches.includes('main')) setDefaultBranch('main');
      else if (result.branches.includes('master')) setDefaultBranch('master');
      else if (result.branches.length > 0) setDefaultBranch(result.branches[0]);
    } catch (err) {
      console.error('[Settings] Repo path validation failed:', err);
      setPathValid(false);
      setBranches([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !path || !pathValid) return;
    await addRepo.mutateAsync({ name, path, defaultBranch });
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border rounded-lg p-4 bg-muted/30">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FolderGit2 className="h-4 w-4" /> Add Repository
      </div>
      <div className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="repo-name">Name</Label>
          <Input
            id="repo-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., rubicon"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="repo-path">Path</Label>
          <div className="flex gap-2">
            <Input
              id="repo-path"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setPathValid(null);
                setBranches([]);
              }}
              placeholder="e.g., ~/Projects/rubicon"
              className={cn(
                pathValid === true && 'border-green-500',
                pathValid === false && 'border-red-500'
              )}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleValidatePath}
              disabled={!path || validatePath.isPending}
            >
              {validatePath.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : pathValid === true ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : pathValid === false ? (
                <X className="h-4 w-4 text-red-500" />
              ) : (
                'Validate'
              )}
            </Button>
          </div>
          {pathValid === false && (
            <p className="text-xs text-red-500">{validatePath.error?.message || 'Invalid path'}</p>
          )}
        </div>
        {branches.length > 0 && (
          <div className="grid gap-2">
            <Label htmlFor="default-branch">Default Branch</Label>
            <Select value={defaultBranch} onValueChange={setDefaultBranch}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name || !path || !pathValid || addRepo.isPending}>
          {addRepo.isPending ? 'Adding...' : 'Add Repository'}
        </Button>
      </div>
    </form>
  );
}

function RepoItem({ repo }: { repo: RepoConfig }) {
  const removeRepo = useRemoveRepo();
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md border bg-card">
      <div className="flex items-center gap-3">
        <FolderGit2 className="h-4 w-4 text-muted-foreground" />
        <div>
          <div className="font-medium">{repo.name}</div>
          <div className="text-xs text-muted-foreground">{repo.path}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs bg-muted px-2 py-0.5 rounded">{repo.defaultBranch}</span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove repository?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove "{repo.name}" from your configuration.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => removeRepo.mutate(repo.name)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
