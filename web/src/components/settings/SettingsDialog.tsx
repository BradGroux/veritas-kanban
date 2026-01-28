import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  useConfig,
  useAddRepo,
  useRemoveRepo,
  useValidateRepoPath,
  useUpdateAgents,
  useSetDefaultAgent,
} from '@/hooks/useConfig';
import {
  useTemplates,
  useCreateTemplate,
  useDeleteTemplate,
  type TaskTemplate,
} from '@/hooks/useTemplates';
import {
  useFeatureSettings,
  useDebouncedFeatureUpdate,
} from '@/hooks/useFeatureSettings';
import {
  Plus, Trash2, Check, X, Loader2, FolderGit2, Bot, Star, FileText,
  Download, Upload, HelpCircle, Info, Settings2, Layout, ListTodo,
  Cpu, Database, Bell, Archive, RotateCcw, Save,
} from 'lucide-react';
import type {
  RepoConfig, AgentConfig, AgentType, TaskPriority,
  TaskTypeConfig, SprintConfig, ProjectConfig,
} from '@veritas-kanban/shared';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';
import { TEMPLATE_CATEGORIES, getCategoryIcon, getCategoryLabel } from '@/lib/template-categories';
import { exportAllTemplates, parseTemplateFile, checkDuplicateName } from '@/lib/template-io';
import { useTaskTypesManager, getTypeIcon, getAvailableIcons, AVAILABLE_COLORS } from '@/hooks/useTaskTypes';
import { useProjectsManager, AVAILABLE_PROJECT_COLORS } from '@/hooks/useProjects';
import { useSprintsManager } from '@/hooks/useSprints';
import { ManagedListManager } from './ManagedListManager';

// ============ Tab Configuration ============

type TabId = 'general' | 'board' | 'tasks' | 'agents' | 'data' | 'notifications' | 'manage';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const TABS: TabDef[] = [
  { id: 'general',       label: 'General',       icon: Settings2 },
  { id: 'board',         label: 'Board',         icon: Layout },
  { id: 'tasks',         label: 'Tasks',         icon: ListTodo },
  { id: 'agents',        label: 'Agents',        icon: Cpu },
  { id: 'data',          label: 'Data',          icon: Database },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'manage',        label: 'Manage',        icon: Archive },
];

// ============ Settings Dialog Props ============

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============ Shared Setting Row Components ============

function SettingRow({ label, description, children }: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onCheckedChange }: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <SettingRow label={label} description={description}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </SettingRow>
  );
}

function NumberRow({ label, description, value, onChange, min, max, unit }: {
  label: string;
  description?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  unit?: string;
}) {
  return (
    <SettingRow label={label} description={description}>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v)) {
              const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
              onChange(clamped);
            }
          }}
          min={min}
          max={max}
          className="w-20 h-8 text-right"
        />
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
    </SettingRow>
  );
}

function SectionHeader({ title, onReset }: { title: string; onReset?: () => void }) {
  return (
    <div className="flex items-center justify-between pb-2 mb-2 border-b">
      <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h4>
      {onReset && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset to defaults?</AlertDialogTitle>
              <AlertDialogDescription>
                This will reset all {title.toLowerCase()} settings to their default values.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onReset}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function SaveIndicator({ isPending }: { isPending: boolean }) {
  const [showSaved, setShowSaved] = useState(false);
  const [wasPending, setWasPending] = useState(false);

  useEffect(() => {
    if (isPending) {
      setWasPending(true);
    } else if (wasPending) {
      setShowSaved(true);
      setWasPending(false);
      const timer = setTimeout(() => setShowSaved(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isPending, wasPending]);

  if (isPending) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
        <Save className="h-3 w-3" />
        Saving...
      </div>
    );
  }
  if (showSaved) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-500">
        <Check className="h-3 w-3" />
        Saved
      </div>
    );
  }
  return null;
}

// ============ Tab Panels ============

// --- General Tab ---
function GeneralTab() {
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
            {config?.repos.map((repo) => <RepoItem key={repo.name} repo={repo} />)}
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
            {config?.agents.filter(a => a.enabled).map((agent) => (
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

// --- Board Tab ---
function BoardTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

  const update = (key: string, value: any) => {
    debouncedUpdate({ board: { [key]: value } });
  };

  const resetBoard = () => {
    debouncedUpdate({ board: DEFAULT_FEATURE_SETTINGS.board });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader title="Board & Display" onReset={resetBoard} />
        <SaveIndicator isPending={isPending} />
      </div>
      <div className="divide-y">
        <ToggleRow
          label="Show Dashboard"
          description="Display the metrics dashboard section above the board"
          checked={settings.board.showDashboard}
          onCheckedChange={(v) => update('showDashboard', v)}
        />
        <ToggleRow
          label="Archive Suggestions"
          description="Show banner when all sprint tasks are complete"
          checked={settings.board.showArchiveSuggestions}
          onCheckedChange={(v) => update('showArchiveSuggestions', v)}
        />
        <SettingRow label="Card Density" description="Compact cards use less space">
          <Select
            value={settings.board.cardDensity}
            onValueChange={(v) => update('cardDensity', v)}
          >
            <SelectTrigger className="w-28 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="compact">Compact</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <ToggleRow
          label="Priority Indicators"
          description="Show priority badge on task cards"
          checked={settings.board.showPriorityIndicators}
          onCheckedChange={(v) => update('showPriorityIndicators', v)}
        />
        <ToggleRow
          label="Project Badges"
          description="Show project badge on task cards"
          checked={settings.board.showProjectBadges}
          onCheckedChange={(v) => update('showProjectBadges', v)}
        />
        <ToggleRow
          label="Sprint Badges"
          description="Show sprint badge on task cards"
          checked={settings.board.showSprintBadges}
          onCheckedChange={(v) => update('showSprintBadges', v)}
        />
        <ToggleRow
          label="Drag & Drop"
          description="Allow dragging cards between columns"
          checked={settings.board.enableDragAndDrop}
          onCheckedChange={(v) => update('enableDragAndDrop', v)}
        />
      </div>
    </div>
  );
}

// --- Tasks Tab ---
function TasksTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

  const update = (key: string, value: any) => {
    debouncedUpdate({ tasks: { [key]: value } });
  };

  const resetTasks = () => {
    debouncedUpdate({ tasks: DEFAULT_FEATURE_SETTINGS.tasks });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader title="Task Behavior" onReset={resetTasks} />
        <SaveIndicator isPending={isPending} />
      </div>
      <div className="divide-y">
        <ToggleRow
          label="Time Tracking"
          description="Enable time tracking on tasks"
          checked={settings.tasks.enableTimeTracking}
          onCheckedChange={(v) => update('enableTimeTracking', v)}
        />
        <ToggleRow
          label="Auto-Complete on Subtasks"
          description="Automatically complete parent when all subtasks are done"
          checked={settings.tasks.enableSubtaskAutoComplete}
          onCheckedChange={(v) => update('enableSubtaskAutoComplete', v)}
        />
        <ToggleRow
          label="Dependencies"
          description="Enable task dependency tracking"
          checked={settings.tasks.enableDependencies}
          onCheckedChange={(v) => update('enableDependencies', v)}
        />
        <ToggleRow
          label="Attachments"
          description="Allow file attachments on tasks"
          checked={settings.tasks.enableAttachments}
          onCheckedChange={(v) => update('enableAttachments', v)}
        />
        {settings.tasks.enableAttachments && (
          <>
            <NumberRow
              label="Max File Size"
              description="Maximum size per attachment"
              value={Math.round(settings.tasks.attachmentMaxFileSize / (1024 * 1024))}
              onChange={(v) => update('attachmentMaxFileSize', v * 1024 * 1024)}
              min={1}
              max={100}
              unit="MB"
            />
            <NumberRow
              label="Max Files Per Task"
              description="Maximum number of attachments per task"
              value={settings.tasks.attachmentMaxPerTask}
              onChange={(v) => update('attachmentMaxPerTask', v)}
              min={1}
              max={100}
            />
            <NumberRow
              label="Max Total Size"
              description="Maximum total attachment size per task"
              value={Math.round(settings.tasks.attachmentMaxTotalSize / (1024 * 1024))}
              onChange={(v) => update('attachmentMaxTotalSize', v * 1024 * 1024)}
              min={1}
              max={500}
              unit="MB"
            />
          </>
        )}
        <ToggleRow
          label="Comments"
          description="Enable comments on tasks"
          checked={settings.tasks.enableComments}
          onCheckedChange={(v) => update('enableComments', v)}
        />
        <SettingRow label="Default Priority" description="Default priority for new tasks">
          <Select
            value={settings.tasks.defaultPriority}
            onValueChange={(v) => update('defaultPriority', v)}
          >
            <SelectTrigger className="w-28 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </div>
    </div>
  );
}

// --- Agents Tab ---
function AgentsTab() {
  const { data: config, isLoading } = useConfig();
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();
  const updateAgents = useUpdateAgents();

  const update = (key: string, value: any) => {
    debouncedUpdate({ agents: { [key]: value } });
  };

  const handleToggleAgent = (agentType: AgentType) => {
    if (!config) return;
    const updatedAgents = config.agents.map(a =>
      a.type === agentType ? { ...a, enabled: !a.enabled } : a
    );
    updateAgents.mutate(updatedAgents);
  };

  const resetAgents = () => {
    debouncedUpdate({ agents: DEFAULT_FEATURE_SETTINGS.agents });
  };

  return (
    <div className="space-y-6">
      {/* Agent List */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Installed Agents</h3>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-2">
            {config?.agents.map((agent) => (
              <AgentToggleItem
                key={agent.type}
                agent={agent}
                onToggle={() => handleToggleAgent(agent.type)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Agent Behavior */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeader title="Agent Behavior" onReset={resetAgents} />
          <SaveIndicator isPending={isPending} />
        </div>
        <div className="divide-y">
          <NumberRow
            label="Timeout"
            description="Kill agent process after N minutes (5-480)"
            value={settings.agents.timeoutMinutes}
            onChange={(v) => update('timeoutMinutes', v)}
            min={5}
            max={480}
            unit="min"
          />
          <ToggleRow
            label="Auto-Commit on Complete"
            description="Automatically commit changes when agent finishes successfully"
            checked={settings.agents.autoCommitOnComplete}
            onCheckedChange={(v) => update('autoCommitOnComplete', v)}
          />
          <ToggleRow
            label="Auto-Cleanup Worktrees"
            description="Remove worktree when task is archived"
            checked={settings.agents.autoCleanupWorktrees}
            onCheckedChange={(v) => update('autoCleanupWorktrees', v)}
          />
          <ToggleRow
            label="Preview Panel"
            description="Show preview panel in task detail view"
            checked={settings.agents.enablePreview}
            onCheckedChange={(v) => update('enablePreview', v)}
          />
        </div>
      </div>
    </div>
  );
}

function AgentToggleItem({ agent, onToggle }: { agent: AgentConfig; onToggle: () => void }) {
  return (
    <div className={cn(
      'flex items-center justify-between py-2 px-3 rounded-md border',
      agent.enabled ? 'bg-card' : 'bg-muted/30'
    )}>
      <div className="flex items-center gap-3">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <div>
          <div className={cn('font-medium text-sm', !agent.enabled && 'text-muted-foreground')}>
            {agent.name}
          </div>
          <code className="text-xs text-muted-foreground">
            {agent.command} {agent.args.join(' ')}
          </code>
        </div>
      </div>
      <Switch checked={agent.enabled} onCheckedChange={onToggle} />
    </div>
  );
}

// --- Data Tab ---
function DataTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

  const updateTelemetry = (key: string, value: any) => {
    debouncedUpdate({ telemetry: { [key]: value } });
  };

  const updateArchive = (key: string, value: any) => {
    debouncedUpdate({ archive: { [key]: value } });
  };

  const resetData = () => {
    debouncedUpdate({
      telemetry: DEFAULT_FEATURE_SETTINGS.telemetry,
      archive: DEFAULT_FEATURE_SETTINGS.archive,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="Telemetry & Data" onReset={resetData} />
        <SaveIndicator isPending={isPending} />
      </div>

      {/* Telemetry */}
      <div className="divide-y">
        <ToggleRow
          label="Telemetry Collection"
          description="Master toggle for all telemetry event collection"
          checked={settings.telemetry.enabled}
          onCheckedChange={(v) => updateTelemetry('enabled', v)}
        />
        {settings.telemetry.enabled && (
          <>
            <NumberRow
              label="Retention Period"
              description="Auto-purge events older than N days (7-365)"
              value={settings.telemetry.retentionDays}
              onChange={(v) => updateTelemetry('retentionDays', v)}
              min={7}
              max={365}
              unit="days"
            />
            <ToggleRow
              label="Trace Collection"
              description="Enable detailed trace collection for agent runs"
              checked={settings.telemetry.enableTraces}
              onCheckedChange={(v) => updateTelemetry('enableTraces', v)}
            />
            <ToggleRow
              label="Activity Tracking"
              description="Log activity events for the sidebar"
              checked={settings.telemetry.enableActivityTracking}
              onCheckedChange={(v) => updateTelemetry('enableActivityTracking', v)}
            />
          </>
        )}
      </div>

      {/* Archive */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Archive</h4>
        <div className="divide-y">
          <ToggleRow
            label="Auto-Archive"
            description="Automatically archive completed sprints"
            checked={settings.archive.autoArchiveEnabled}
            onCheckedChange={(v) => updateArchive('autoArchiveEnabled', v)}
          />
          {settings.archive.autoArchiveEnabled && (
            <NumberRow
              label="Archive After"
              description="Days after completion before auto-archiving"
              value={settings.archive.autoArchiveAfterDays}
              onChange={(v) => updateArchive('autoArchiveAfterDays', v)}
              min={1}
              max={365}
              unit="days"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// --- Notifications Tab ---
function NotificationsTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

  const update = (key: string, value: any) => {
    debouncedUpdate({ notifications: { [key]: value } });
  };

  const resetNotifications = () => {
    debouncedUpdate({ notifications: DEFAULT_FEATURE_SETTINGS.notifications });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader title="Notifications" onReset={resetNotifications} />
        <SaveIndicator isPending={isPending} />
      </div>
      <div className="divide-y">
        <ToggleRow
          label="Enable Notifications"
          description="Master toggle for all notification sends"
          checked={settings.notifications.enabled}
          onCheckedChange={(v) => update('enabled', v)}
        />
        {settings.notifications.enabled && (
          <>
            <ToggleRow
              label="Task Complete"
              description="Notify when a task moves to Done"
              checked={settings.notifications.onTaskComplete}
              onCheckedChange={(v) => update('onTaskComplete', v)}
            />
            <ToggleRow
              label="Agent Failure"
              description="Notify when an agent run fails"
              checked={settings.notifications.onAgentFailure}
              onCheckedChange={(v) => update('onAgentFailure', v)}
            />
            <ToggleRow
              label="Review Needed"
              description="Notify when a task moves to Review"
              checked={settings.notifications.onReviewNeeded}
              onCheckedChange={(v) => update('onReviewNeeded', v)}
            />
            <SettingRow label="Channel" description="Teams channel ID for notifications">
              <Input
                value={settings.notifications.channel}
                onChange={(e) => update('channel', e.target.value)}
                placeholder="19:abc...@thread.tacv2"
                className="w-48 h-8 text-xs"
              />
            </SettingRow>
          </>
        )}
      </div>
    </div>
  );
}

// --- Manage Tab (existing managed lists + templates) ---
function ManageTab() {
  const { data: _config } = useConfig();
  const { data: templates, isLoading: templatesLoading } = useTemplates();
  const taskTypesManager = useTaskTypesManager();
  const projectsManager = useProjectsManager();
  const sprintsManager = useSprintsManager();
  const [showAddTemplateForm, setShowAddTemplateForm] = useState(false);
  const [showTemplateHelp, setShowTemplateHelp] = useState(false);
  const createTemplate = useCreateTemplate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportTemplates = () => {
    if (!templates || templates.length === 0) {
      alert('No templates to export.');
      return;
    }
    exportAllTemplates(templates);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseTemplateFile(file);
      const templatesToImport = Array.isArray(parsed) ? parsed : [parsed];
      let imported = 0;
      let skipped = 0;
      for (const template of templatesToImport) {
        if (checkDuplicateName(template.name, templates || [])) {
          skipped++;
          continue;
        }
        await createTemplate.mutateAsync({
          name: template.name,
          description: template.description,
          category: template.category,
          taskDefaults: template.taskDefaults,
          subtaskTemplates: template.subtaskTemplates,
          blueprint: template.blueprint,
        });
        imported++;
      }
      alert(`Import complete: ${imported} imported${skipped > 0 ? `, ${skipped} duplicates skipped` : ''}.`);
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : 'Invalid file'}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Task Types */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Task Types</h3>
        <div className="border rounded-lg p-4">
          <ManagedListManager<TaskTypeConfig>
            title=""
            items={taskTypesManager.items}
            isLoading={taskTypesManager.isLoading}
            onCreate={taskTypesManager.create}
            onUpdate={taskTypesManager.update}
            onDelete={taskTypesManager.remove}
            onReorder={taskTypesManager.reorder}
            canDeleteCheck={taskTypesManager.canDelete}
            renderExtraFields={(item, onChange) => (
              <div className="flex gap-2 mt-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Icon</Label>
                  <Select value={item.icon} onValueChange={(icon) => onChange({ icon })}>
                    <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {getAvailableIcons().map((iconName) => {
                        const IconComponent = getTypeIcon(iconName);
                        return (
                          <SelectItem key={iconName} value={iconName}>
                            <div className="flex items-center gap-2">
                              {IconComponent && <IconComponent className="h-4 w-4" />}
                              {iconName}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Color</Label>
                  <Select value={item.color || 'border-l-gray-500'} onValueChange={(color) => onChange({ color })}>
                    <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AVAILABLE_COLORS.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded border-l-4 ${color.value}`}></div>
                            {color.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            newItemDefaults={{ icon: 'Code', color: 'border-l-gray-500' }}
          />
        </div>
      </div>

      {/* Projects */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Projects</h3>
        <div className="border rounded-lg p-4">
          <ManagedListManager<ProjectConfig>
            title=""
            items={projectsManager.items}
            isLoading={projectsManager.isLoading}
            onCreate={projectsManager.create}
            onUpdate={projectsManager.update}
            onDelete={projectsManager.remove}
            onReorder={projectsManager.reorder}
            canDeleteCheck={projectsManager.canDelete}
            renderExtraFields={(item, onChange) => (
              <div className="flex gap-2 mt-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <Input
                    value={item.description || ''}
                    onChange={(e) => onChange({ description: e.target.value })}
                    placeholder="Optional description..."
                    className="h-8 mt-1"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Badge Color</Label>
                  <Select value={item.color || 'bg-muted'} onValueChange={(color) => onChange({ color })}>
                    <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AVAILABLE_PROJECT_COLORS.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded ${color.value}`}></div>
                            {color.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            newItemDefaults={{ description: '', color: 'bg-blue-500/20' }}
          />
        </div>
      </div>

      {/* Sprints */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Sprints</h3>
        <div className="border rounded-lg p-4">
          <ManagedListManager<SprintConfig>
            title=""
            items={sprintsManager.items}
            isLoading={sprintsManager.isLoading}
            onCreate={sprintsManager.create}
            onUpdate={sprintsManager.update}
            onDelete={sprintsManager.remove}
            onReorder={sprintsManager.reorder}
            canDeleteCheck={sprintsManager.canDelete}
            renderExtraFields={(item, onChange) => (
              <div className="mt-2">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <Input
                  value={item.description || ''}
                  onChange={(e) => onChange({ description: e.target.value })}
                  placeholder="Optional description..."
                  className="h-8 mt-1"
                />
              </div>
            )}
            newItemDefaults={{ description: '' }}
          />
        </div>
      </div>

      {/* Templates */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Task Templates</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setShowTemplateHelp(!showTemplateHelp)}
            >
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleImportClick}>
              <Upload className="h-4 w-4 mr-1" /> Import
            </Button>
            {templates && templates.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleExportTemplates}>
                <Download className="h-4 w-4 mr-1" /> Export
              </Button>
            )}
            {!showAddTemplateForm && (
              <Button variant="outline" size="sm" onClick={() => setShowAddTemplateForm(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            )}
          </div>
        </div>

        {showTemplateHelp && (
          <div className="p-3 rounded-md bg-muted/50 border border-muted-foreground/20 text-sm space-y-3">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="space-y-2">
                <p className="font-medium text-sm">Template Guide</p>
                <div className="text-xs text-muted-foreground space-y-1.5">
                  <div><strong className="text-foreground">Simple:</strong> Pre-fill fields + subtask lists</div>
                  <div><strong className="text-foreground">Categories:</strong> Bug 🐛, Feature ✨, Sprint 🔄</div>
                  <div><strong className="text-foreground">Variables:</strong> {'{{date}}'}, {'{{project}}'}, {'{{custom}}'}</div>
                  <div><strong className="text-foreground">Blueprints:</strong> Multi-task with dependencies</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileSelect}
          className="hidden"
        />

        {showAddTemplateForm && (
          <AddTemplateForm onClose={() => setShowAddTemplateForm(false)} />
        )}

        {templatesLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : !templates || templates.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border rounded-md border-dashed">
            No templates created.
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((template) => (
              <TemplateItem key={template.id} template={template} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Shared Sub-Components (extracted from original) ============

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
    } catch {
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
          <Input id="repo-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., rubicon" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="repo-path">Path</Label>
          <div className="flex gap-2">
            <Input
              id="repo-path"
              value={path}
              onChange={(e) => { setPath(e.target.value); setPathValid(null); setBranches([]); }}
              placeholder="e.g., ~/Projects/rubicon"
              className={cn(pathValid === true && 'border-green-500', pathValid === false && 'border-red-500')}
            />
            <Button type="button" variant="outline" onClick={handleValidatePath} disabled={!path || validatePath.isPending}>
              {validatePath.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : pathValid === true ? <Check className="h-4 w-4 text-green-500" /> : pathValid === false ? <X className="h-4 w-4 text-red-500" /> : 'Validate'}
            </Button>
          </div>
          {pathValid === false && <p className="text-xs text-red-500">{validatePath.error?.message || 'Invalid path'}</p>}
        </div>
        {branches.length > 0 && (
          <div className="grid gap-2">
            <Label htmlFor="default-branch">Default Branch</Label>
            <Select value={defaultBranch} onValueChange={setDefaultBranch}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {branches.map((branch) => <SelectItem key={branch} value={branch}>{branch}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
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
              <AlertDialogDescription>This will remove "{repo.name}" from your configuration.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => removeRepo.mutate(repo.name)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function AddTemplateForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('');
  const [type, setType] = useState<string>('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [project, setProject] = useState('');
  const [agent, setAgent] = useState<AgentType | ''>('');
  const [descriptionTemplate, setDescriptionTemplate] = useState('');
  const createTemplate = useCreateTemplate();
  const { items: taskTypes } = useTaskTypesManager();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createTemplate.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
      category: category || undefined,
      taskDefaults: {
        type: type || undefined,
        priority: priority || undefined,
        project: project.trim() || undefined,
        agent: agent || undefined,
        descriptionTemplate: descriptionTemplate.trim() || undefined,
      },
    });
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border rounded-lg p-4 bg-muted/30">
      <div className="flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4" /> Add Template</div>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Bug Fix" />
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g., Template for bug fixes" />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue placeholder="Select category..." /></SelectTrigger>
            <SelectContent>
              {Object.entries(TEMPLATE_CATEGORIES).map(([key, { label, icon }]) => (
                <SelectItem key={key} value={key}>{icon} {label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Default Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                {taskTypes.map((taskType) => {
                  const IconComponent = getTypeIcon(taskType.icon);
                  return (
                    <SelectItem key={taskType.id} value={taskType.id}>
                      <div className="flex items-center gap-2">
                        {IconComponent && <IconComponent className="h-4 w-4" />}
                        {taskType.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Default Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Default Project</Label>
            <Input value={project} onChange={(e) => setProject(e.target.value)} placeholder="e.g., rubicon" />
          </div>
          <div className="grid gap-2">
            <Label>Preferred Agent</Label>
            <Select value={agent} onValueChange={(v) => setAgent(v as AgentType)}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-code">Claude Code</SelectItem>
                <SelectItem value="amp">Amp</SelectItem>
                <SelectItem value="copilot">Copilot</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="veritas">Veritas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Description Template</Label>
          <Textarea value={descriptionTemplate} onChange={(e) => setDescriptionTemplate(e.target.value)} placeholder="Pre-filled description text..." rows={2} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!name.trim() || createTemplate.isPending}>
          {createTemplate.isPending ? 'Creating...' : 'Create Template'}
        </Button>
      </div>
    </form>
  );
}

function TemplateItem({ template }: { template: TaskTemplate }) {
  const deleteTemplate = useDeleteTemplate();
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md border bg-card">
      <div className="flex items-center gap-3">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{template.name}</span>
            {template.category && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted">
                {getCategoryIcon(template.category)} {getCategoryLabel(template.category)}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {[template.taskDefaults.type, template.taskDefaults.priority, template.taskDefaults.project, template.taskDefaults.agent].filter(Boolean).join(' • ') || 'No defaults'}
          </div>
        </div>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>This will delete "{template.name}".</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTemplate.mutate(template.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ Main Settings Dialog ============

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentIndex = TABS.findIndex(t => t.id === activeTab);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (currentIndex + 1) % TABS.length;
      setActiveTab(TABS[next].id);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (currentIndex - 1 + TABS.length) % TABS.length;
      setActiveTab(TABS[prev].id);
    }
  }, [activeTab]);

  const renderTab = () => {
    switch (activeTab) {
      case 'general':       return <GeneralTab />;
      case 'board':         return <BoardTab />;
      case 'tasks':         return <TasksTab />;
      case 'agents':        return <AgentsTab />;
      case 'data':          return <DataTab />;
      case 'notifications': return <NotificationsTab />;
      case 'manage':        return <ManageTab />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[85vh] p-0 overflow-hidden">
        <div className="flex h-full">
          {/* Sidebar Tabs — hidden on narrow screens, shown as dropdown instead */}
          <div className="hidden sm:flex flex-col w-48 border-r bg-muted/30 py-4">
            <div className="px-4 pb-3">
              <h2 className="text-sm font-semibold">Settings</h2>
            </div>
            <nav
              className="flex-1 space-y-0.5 px-2"
              role="tablist"
              aria-orientation="vertical"
              onKeyDown={handleKeyDown}
            >
              {TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    tabIndex={activeTab === tab.id ? 0 : -1}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left',
                      activeTab === tab.id
                        ? 'bg-background shadow-sm font-medium'
                        : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Mobile Tab Selector */}
          <div className="sm:hidden absolute top-3 right-12">
            <Select value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
              <SelectTrigger className="w-36 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TABS.map((tab) => (
                  <SelectItem key={tab.id} value={tab.id}>{tab.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0">
            <DialogHeader className="px-6 py-4 border-b sm:hidden">
              <DialogTitle>Settings</DialogTitle>
            </DialogHeader>
            <ScrollArea className="flex-1 px-6 py-4">
              <div className="max-w-lg">
                {renderTab()}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
