import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import {
  useConfig,
  useAddRepo,
  useRemoveRepo,
  useValidateRepoPath,
  useSetDefaultAgent,
} from '@/hooks/useConfig';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import {
  Plus,
  Trash2,
  Check,
  X,
  Loader2,
  FolderGit2,
  Bot,
  Star,
  Moon,
  Sun,
  User,
} from 'lucide-react';
import type { RepoConfig, AgentConfig, ProductModeId } from '@veritas-kanban/shared';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import { PRODUCT_MODE_DEFINITIONS, productModeDefinition } from '@/lib/product-modes';

const PRODUCT_MODE_OPTIONS = PRODUCT_MODE_DEFINITIONS.map((mode) => ({
  value: mode.id,
  label: mode.label,
}));

export function GeneralTab() {
  const { data: config, isLoading } = useConfig();
  const [showAddForm, setShowAddForm] = useState(false);
  const { theme, setTheme } = useTheme();
  const { settings } = useFeatureSettings();
  const { debouncedUpdate } = useDebouncedFeatureUpdate();
  const selectedProductMode =
    settings.productMode?.selectedMode ?? DEFAULT_FEATURE_SETTINGS.productMode.selectedMode;
  const activeProductMode = productModeDefinition(selectedProductMode);
  const [localDisplayName, setLocalDisplayName] = useState(
    settings.general?.humanDisplayName ?? DEFAULT_FEATURE_SETTINGS.general.humanDisplayName
  );

  return (
    <div className="space-y-6">
      {/* Appearance */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Appearance</h3>
        <div className="flex items-center justify-between py-2 px-3 rounded-md border bg-card">
          <div className="flex items-center gap-3">
            {theme === 'dark' ? (
              <Moon className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Sun className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <div className="font-medium text-sm">Dark Mode</div>
              <div className="text-xs text-muted-foreground">
                {theme === 'dark' ? 'Dark theme active' : 'Light theme active'}
              </div>
            </div>
          </div>
          <Switch
            checked={theme === 'dark'}
            onChange={(event) => setTheme(event.currentTarget.checked ? 'dark' : 'light')}
            aria-label="Toggle dark mode"
            className="flex min-h-8 items-center"
            size="sm"
          />
        </div>
      </div>

      {/* Product Mode */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Product Mode</h3>
        <div className="rounded-md border p-4 bg-card space-y-4">
          <Group justify="space-between" align="flex-start" gap="md">
            <div className="min-w-0 flex-1 space-y-1">
              <Group gap={8}>
                <Badge variant="light" color={selectedProductMode === 'advanced' ? 'gray' : 'cyan'}>
                  {activeProductMode.label}
                </Badge>
                <Text size="sm" fw={600}>
                  Focus preset
                </Text>
              </Group>
              <Text size="sm" c="dimmed">
                {activeProductMode.description}
              </Text>
            </div>
            <Select
              label="Product Mode"
              value={selectedProductMode}
              data={PRODUCT_MODE_OPTIONS}
              allowDeselect={false}
              maw={260}
              onChange={(value) => {
                if (!value) return;
                debouncedUpdate({
                  productMode: {
                    selectedMode: value as ProductModeId,
                    lastSelectedAt: new Date().toISOString(),
                  },
                });
              }}
            />
          </Group>

          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
            <ModeDetail label="Surfaces" items={activeProductMode.visibleSurfaces} />
            <ModeDetail label="Task Template" items={[activeProductMode.defaultTaskTemplate]} />
            <ModeDetail label="Shortcuts" items={activeProductMode.commandShortcuts} />
          </SimpleGrid>
        </div>
      </div>

      {/* User Preferences */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">User Preferences</h3>
        <div className="rounded-md border p-4 bg-card space-y-3">
          <div className="grid gap-2">
            <TextInput
              id="human-display-name"
              label={
                <Group gap={6}>
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span>Display Name (Squad Chat)</span>
                </Group>
              }
              value={localDisplayName}
              onChange={(e) => setLocalDisplayName(e.target.value)}
              onBlur={() =>
                debouncedUpdate({ general: { humanDisplayName: localDisplayName || 'Human' } })
              }
              placeholder="Human"
              maw={320}
            />
            <p className="text-xs text-muted-foreground">
              How your messages appear in Squad Chat. Shows as "{localDisplayName} (Human)" in the
              chat.
            </p>
          </div>
        </div>
      </div>

      {/* Repositories */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Git Repositories</h3>
          {!showAddForm && (
            <Button
              variant="outline"
              size="xs"
              leftSection={<Plus className="h-4 w-4" />}
              onClick={() => setShowAddForm(true)}
            >
              Add Repo
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

function ModeDetail({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="rounded-md border bg-background/50 p-3">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Group gap={6} mt={8}>
        {items.slice(0, 4).map((item) => (
          <Badge key={item} size="xs" variant="outline" color="gray">
            {item}
          </Badge>
        ))}
      </Group>
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
        variant={isDefault ? 'filled' : 'subtle'}
        size="xs"
        leftSection={<Star className={cn('h-3 w-3', isDefault && 'fill-current')} />}
        onClick={() => setDefaultAgent.mutate(agent.type)}
        disabled={isDefault}
      >
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
          <TextInput
            id="repo-name"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., rubicon"
          />
        </div>
        <div className="grid gap-2">
          <div className="flex items-end gap-2">
            <TextInput
              id="repo-path"
              label="Path"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setPathValid(null);
                setBranches([]);
              }}
              placeholder="e.g., ~/Projects/rubicon"
              error={pathValid === false ? validatePath.error?.message || 'Invalid path' : null}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleValidatePath}
              disabled={!path || validatePath.isPending}
              aria-label={
                validatePath.isPending
                  ? 'Validating repository path'
                  : pathValid === true
                    ? 'Repository path valid'
                    : pathValid === false
                      ? 'Repository path invalid'
                      : 'Validate repository path'
              }
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
        </div>
        {branches.length > 0 && (
          <div className="grid gap-2">
            <Select
              id="default-branch"
              label="Default Branch"
              value={defaultBranch}
              onChange={(value) => value && setDefaultBranch(value)}
              data={branches.map((branch) => ({ value: branch, label: branch }))}
              allowDeselect={false}
            />
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!name || !path || !pathValid || addRepo.isPending}
        >
          {addRepo.isPending ? 'Adding...' : 'Add Repository'}
        </Button>
      </div>
    </form>
  );
}

function RepoItem({ repo }: { repo: RepoConfig }) {
  const removeRepo = useRemoveRepo();
  const [removeOpen, setRemoveOpen] = useState(false);

  const handleRemove = () => {
    removeRepo.mutate(repo.name);
    setRemoveOpen(false);
  };

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
        <Badge variant="light" color="gray" size="sm">
          {repo.defaultBranch}
        </Badge>
        <ActionIcon
          type="button"
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={`Remove ${repo.name}`}
          onClick={() => setRemoveOpen(true)}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
        </ActionIcon>
        <Modal
          opened={removeOpen}
          onClose={() => setRemoveOpen(false)}
          title="Remove repository?"
          centered
        >
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              This will remove "{repo.name}" from your configuration.
            </Text>
            <Group justify="flex-end">
              <Button variant="subtle" color="gray" onClick={() => setRemoveOpen(false)}>
                Cancel
              </Button>
              <Button color="red" onClick={handleRemove}>
                Remove
              </Button>
            </Group>
          </Stack>
        </Modal>
      </div>
    </div>
  );
}
