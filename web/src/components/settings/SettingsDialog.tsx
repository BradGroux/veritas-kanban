import { useState, useRef, useCallback, lazy, Suspense, useEffect, useMemo } from 'react';
import {
  Badge,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { useIdentity } from '@/hooks/useIdentity';
import { useToast } from '@/hooks/useToast';
import {
  Settings2,
  Layout,
  ListTodo,
  ListChecks,
  Cpu,
  Database,
  Bell,
  Archive,
  Download,
  Upload,
  RotateCcw,
  Shield,
  Plane,
  Lock,
  CheckCircle2,
  Boxes,
  BookOpen,
  UserCog,
  Wrench,
  Network,
  CalendarClock,
  BrainCircuit,
  Waypoints,
} from 'lucide-react';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import type { ClientAuthPermission } from '@veritas-kanban/shared';
import { SettingsActionGroup, SettingsErrorBoundary } from './shared';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

// Lazy-load tab components
const LazyGeneralTab = lazy(() =>
  import('./tabs/GeneralTab').then((m) => ({ default: m.GeneralTab }))
);
const LazyBoardTab = lazy(() => import('./tabs/BoardTab').then((m) => ({ default: m.BoardTab })));
const LazyTasksTab = lazy(() => import('./tabs/TasksTab').then((m) => ({ default: m.TasksTab })));
const LazyAgentsTab = lazy(() =>
  import('./tabs/AgentsTab').then((m) => ({ default: m.AgentsTab }))
);
const LazyDataTab = lazy(() => import('./tabs/DataTab').then((m) => ({ default: m.DataTab })));
const LazyNotificationsTab = lazy(() =>
  import('./tabs/NotificationsTab').then((m) => ({ default: m.NotificationsTab }))
);
const LazyManageTab = lazy(() =>
  import('./tabs/ManageTab').then((m) => ({ default: m.ManageTab }))
);
const LazySecurityTab = lazy(() =>
  import('./tabs/SecurityTab').then((m) => ({ default: m.SecurityTab }))
);
const LazyDelegationTab = lazy(() =>
  import('./tabs/DelegationTab').then((m) => ({ default: m.DelegationTab }))
);
const LazyToolPoliciesTab = lazy(() =>
  import('./tabs/ToolPoliciesTab').then((m) => ({ default: m.ToolPoliciesTab }))
);
const LazyEnforcementTab = lazy(() =>
  import('./tabs/EnforcementTab').then((m) => ({ default: m.EnforcementTab }))
);
const LazySharedResourcesTab = lazy(() =>
  import('./tabs/SharedResourcesTab').then((m) => ({ default: m.SharedResourcesTab }))
);
const LazyDocFreshnessTab = lazy(() =>
  import('./tabs/DocFreshnessTab').then((m) => ({ default: m.DocFreshnessTab }))
);
const LazyMultiUserTab = lazy(() =>
  import('./tabs/MultiUserTab').then((m) => ({ default: m.MultiUserTab }))
);
const LazyMaintenanceTab = lazy(() =>
  import('./tabs/MaintenanceTab').then((m) => ({ default: m.MaintenanceTab }))
);
const LazyWorkspaceCapabilitiesTab = lazy(() =>
  import('./tabs/WorkspaceCapabilitiesTab').then((m) => ({ default: m.WorkspaceCapabilitiesTab }))
);
const LazySchedulerTab = lazy(() =>
  import('./tabs/SchedulerTab').then((m) => ({ default: m.SchedulerTab }))
);
const LazyQueueMonitorsTab = lazy(() =>
  import('./tabs/QueueMonitorsTab').then((m) => ({ default: m.QueueMonitorsTab }))
);
const LazyReflectionTab = lazy(() =>
  import('./tabs/ReflectionTab').then((m) => ({ default: m.ReflectionTab }))
);
const LazyTrackersTab = lazy(() =>
  import('./tabs/TrackersTab').then((m) => ({ default: m.TrackersTab }))
);

// ============ Tab Skeleton ============

function TabSkeleton() {
  return (
    <Stack gap="md">
      <Skeleton height={24} width={128} radius="sm" />
      <Stack gap="sm">
        <Skeleton height={48} radius="md" />
        <Skeleton height={48} radius="md" />
        <Skeleton height={48} radius="md" />
      </Stack>
    </Stack>
  );
}

// ============ Tab Configuration ============

type TabId =
  | 'general'
  | 'board'
  | 'tasks'
  | 'agents'
  | 'data'
  | 'notifications'
  | 'security'
  | 'delegation'
  | 'tool-policies'
  | 'enforcement'
  | 'shared-resources'
  | 'doc-freshness'
  | 'multi-user'
  | 'workspace-capabilities'
  | 'scheduler'
  | 'queue-monitors'
  | 'reflections'
  | 'trackers'
  | 'maintenance'
  | 'manage';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ElementType;
  requiredPermission?: ClientAuthPermission;
  boardOnlyPrimary?: boolean;
}

interface NavigationGroup {
  id: 'core' | 'collaboration' | 'automation' | 'governance' | 'system';
  label: string;
  tabs: TabDef[];
}

export const SETTINGS_NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    id: 'core',
    label: 'Core',
    tabs: [
      { id: 'general', label: 'General', icon: Settings2, boardOnlyPrimary: true },
      { id: 'board', label: 'Board', icon: Layout, boardOnlyPrimary: true },
      { id: 'tasks', label: 'Tasks', icon: ListTodo, boardOnlyPrimary: true },
      { id: 'agents', label: 'Agents', icon: Cpu, requiredPermission: 'agent:read' },
      { id: 'data', label: 'Data', icon: Database, requiredPermission: 'backup:read' },
    ],
  },
  {
    id: 'collaboration',
    label: 'Collaboration',
    tabs: [
      { id: 'notifications', label: 'Notifications', icon: Bell },
      {
        id: 'multi-user',
        label: 'Multi-user',
        icon: UserCog,
        requiredPermission: 'workspace:read',
      },
      {
        id: 'workspace-capabilities',
        label: 'Workspaces',
        icon: Network,
        requiredPermission: 'workspace:read',
      },
      { id: 'delegation', label: 'Delegation', icon: Plane, requiredPermission: 'agent:read' },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    tabs: [
      {
        id: 'scheduler',
        label: 'Scheduler',
        icon: CalendarClock,
        requiredPermission: 'workflow:read',
      },
      {
        id: 'queue-monitors',
        label: 'Queues',
        icon: ListChecks,
        requiredPermission: 'workflow:read',
      },
      {
        id: 'reflections',
        label: 'Reflections',
        icon: BrainCircuit,
        requiredPermission: 'workflow:read',
      },
      {
        id: 'trackers',
        label: 'Trackers',
        icon: Waypoints,
        requiredPermission: 'settings:read',
      },
    ],
  },
  {
    id: 'governance',
    label: 'Governance',
    tabs: [
      { id: 'security', label: 'Security', icon: Shield, requiredPermission: 'settings:read' },
      {
        id: 'tool-policies',
        label: 'Tool Policies',
        icon: Lock,
        requiredPermission: 'policy:read',
      },
      {
        id: 'enforcement',
        label: 'Enforcement',
        icon: CheckCircle2,
        requiredPermission: 'policy:read',
      },
      { id: 'shared-resources', label: 'Shared Resources', icon: Boxes },
      { id: 'doc-freshness', label: 'Doc Freshness', icon: BookOpen },
    ],
  },
  {
    id: 'system',
    label: 'System',
    tabs: [
      { id: 'maintenance', label: 'Maintenance', icon: Wrench, requiredPermission: 'backup:read' },
      { id: 'manage', label: 'Manage', icon: Archive, requiredPermission: 'backup:read' },
    ],
  },
];

const TABS = SETTINGS_NAVIGATION_GROUPS.flatMap((group) => group.tabs);

// ============ Settings Dialog Props ============

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: string;
}

// ============ Main Settings Dialog ============

export function SettingsDialog({ open, onOpenChange, defaultTab }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const { hasPermission } = useIdentity();
  const { settings: currentSettings } = useFeatureSettings();
  const canWriteSettings = hasPermission('settings:write');
  const canUseTab = useCallback(
    (tab: TabDef) => !tab.requiredPermission || hasPermission(tab.requiredPermission),
    [hasPermission]
  );
  const isBoardOnly = currentSettings.productMode?.selectedMode === 'board-only';
  const mobileTabOptions = useMemo(
    () =>
      SETTINGS_NAVIGATION_GROUPS.map((group) => ({
        group: group.label,
        items: group.tabs.map((tab) => ({
          value: tab.id,
          label: `${tab.label}${isBoardOnly && !tab.boardOnlyPrimary ? ' · Advanced' : ''}`,
          disabled: !canUseTab(tab),
        })),
      })),
    [canUseTab, isBoardOnly]
  );

  // Set active tab when defaultTab changes
  useEffect(() => {
    const requestedTab = TABS.find((t) => t.id === defaultTab);
    if (requestedTab && canUseTab(requestedTab)) {
      setActiveTab(defaultTab as TabId);
    }
  }, [canUseTab, defaultTab]);

  useEffect(() => {
    const currentTab = TABS.find((tab) => tab.id === activeTab);
    if (currentTab && !canUseTab(currentTab)) {
      setActiveTab(TABS.find(canUseTab)?.id ?? 'general');
    }
  }, [activeTab, canUseTab]);
  const { debouncedUpdate } = useDebouncedFeatureUpdate();
  const settingsFileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const firstTabButtonRef = useRef<HTMLButtonElement>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);

  // Focus first tab when dialog opens
  useEffect(() => {
    if (open && firstTabButtonRef.current) {
      // Small delay to ensure dialog is fully rendered
      setTimeout(() => firstTabButtonRef.current?.focus(), 100);
    }
  }, [open]);

  // Focus content area when switching tabs
  useEffect(() => {
    if (contentAreaRef.current) {
      contentAreaRef.current.focus();
      contentAreaRef.current.scrollIntoView({ block: 'start' });
    }
  }, [activeTab]);

  const handleExportSettings = () => {
    const blob = new Blob([JSON.stringify(currentSettings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `veritas-kanban-settings-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportSettings = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!imported || typeof imported !== 'object') {
        toast({
          title: 'Import failed',
          description: 'Invalid settings file: must be a JSON object',
          duration: Infinity,
        });
        return;
      }
      // Validate expected top-level keys
      const validSections = [
        'general',
        'board',
        'tasks',
        'agents',
        'telemetry',
        'notifications',
        'markdown',
        'docFreshness',
        'archive',
        'sharedResources',
      ];
      const importedKeys = Object.keys(imported);
      const unknownKeys = importedKeys.filter((k) => !validSections.includes(k));
      if (unknownKeys.length > 0) {
        toast({
          title: 'Warning',
          description: `Unknown sections will be ignored: ${unknownKeys.join(', ')}`,
          duration: Infinity,
        });
      }
      const validPatch: Record<string, unknown> = {};
      for (const key of importedKeys) {
        if (validSections.includes(key)) {
          validPatch[key] = imported[key];
        }
      }
      if (Object.keys(validPatch).length === 0) {
        toast({
          title: 'Import failed',
          description: 'No valid settings found in file',
          duration: Infinity,
        });
        return;
      }
      if (
        confirm(
          `Import ${Object.keys(validPatch).length} setting sections: ${Object.keys(validPatch).join(', ')}?\n\nThis will overwrite current values.`
        )
      ) {
        debouncedUpdate(validPatch);
        toast({
          title: 'Import complete',
          description: 'Settings imported successfully!',
          duration: 3000,
        });
      }
    } catch (err) {
      console.error('[Settings] Import failed:', err);
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Invalid JSON',
        duration: Infinity,
      });
    } finally {
      if (settingsFileInputRef.current) settingsFileInputRef.current.value = '';
    }
  };

  const handleResetAll = () => {
    debouncedUpdate({ ...DEFAULT_FEATURE_SETTINGS });
    setResetAllOpen(false);
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const availableTabs = TABS.filter(canUseTab);
      const currentIndex = availableTabs.findIndex((t) => t.id === activeTab);
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = (currentIndex + 1) % availableTabs.length;
        setActiveTab(availableTabs[next].id);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = (currentIndex - 1 + availableTabs.length) % availableTabs.length;
        setActiveTab(availableTabs[prev].id);
      }
    },
    [activeTab, canUseTab]
  );

  const handleDialogKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;

    const container = dialogContentRef.current;
    if (!container) return;

    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        [
          'a[href]',
          'button:not([disabled])',
          'input:not([type="hidden"]):not([disabled])',
          'select:not([disabled])',
          'textarea:not([disabled])',
          '[role="button"]:not([aria-disabled="true"])',
          '[role="combobox"]:not([aria-disabled="true"])',
          '[role="tab"]:not([aria-disabled="true"])',
          '[tabindex]:not([tabindex="-1"])',
        ].join(',')
      )
    ).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
    });

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!active || !container.contains(active)) {
      e.preventDefault();
      first.focus();
      return;
    }

    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const renderTab = () => {
    return (
      <Suspense fallback={<TabSkeleton />}>
        {activeTab === 'general' && (
          <SettingsErrorBoundary tabName="General">
            <LazyGeneralTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'board' && (
          <SettingsErrorBoundary tabName="Board">
            <LazyBoardTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'tasks' && (
          <SettingsErrorBoundary tabName="Tasks">
            <LazyTasksTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'agents' && (
          <SettingsErrorBoundary tabName="Agents">
            <LazyAgentsTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'data' && (
          <SettingsErrorBoundary tabName="Data">
            <LazyDataTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'notifications' && (
          <SettingsErrorBoundary tabName="Notifications">
            <LazyNotificationsTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'security' && (
          <SettingsErrorBoundary tabName="Security">
            <LazySecurityTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'multi-user' && (
          <SettingsErrorBoundary tabName="Multi-user">
            <LazyMultiUserTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'workspace-capabilities' && (
          <SettingsErrorBoundary tabName="Workspaces">
            <LazyWorkspaceCapabilitiesTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'scheduler' && (
          <SettingsErrorBoundary tabName="Scheduler">
            <LazySchedulerTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'queue-monitors' && (
          <SettingsErrorBoundary tabName="Queues">
            <LazyQueueMonitorsTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'reflections' && (
          <SettingsErrorBoundary tabName="Reflections">
            <LazyReflectionTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'trackers' && (
          <SettingsErrorBoundary tabName="Trackers">
            <LazyTrackersTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'delegation' && (
          <SettingsErrorBoundary tabName="Delegation">
            <LazyDelegationTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'tool-policies' && (
          <SettingsErrorBoundary tabName="Tool Policies">
            <LazyToolPoliciesTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'enforcement' && (
          <SettingsErrorBoundary tabName="Enforcement">
            <LazyEnforcementTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'shared-resources' && (
          <SettingsErrorBoundary tabName="Shared Resources">
            <LazySharedResourcesTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'doc-freshness' && (
          <SettingsErrorBoundary tabName="Doc Freshness">
            <LazyDocFreshnessTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'manage' && (
          <SettingsErrorBoundary tabName="Manage">
            <LazyManageTab />
          </SettingsErrorBoundary>
        )}
        {activeTab === 'maintenance' && (
          <SettingsErrorBoundary tabName="Maintenance">
            <LazyMaintenanceTab />
          </SettingsErrorBoundary>
        )}
      </Suspense>
    );
  };

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title={<span className="sr-only">Settings</span>}
      size={1040}
      padding={0}
      centered
      trapFocus
      returnFocus
      closeButtonProps={{ 'aria-label': 'Close settings' }}
      classNames={{
        content: 'settings-dialog-content',
        body: 'settings-dialog-body',
      }}
      styles={{
        content: { height: '85vh', overflow: 'hidden' },
        body: { height: '100%', padding: 0 },
        close: { top: '1rem', right: '1rem' },
      }}
    >
      <ErrorBoundary level="section">
        <div
          ref={dialogContentRef}
          className="settings-dialog flex h-full min-h-0"
          onKeyDown={handleDialogKeyDown}
        >
          {/* Sidebar Tabs — hidden on narrow screens, shown as dropdown instead */}
          <div className="hidden min-h-0 w-56 flex-col border-r bg-muted/25 py-4 sm:flex">
            <div className="px-4 pb-3">
              <Group gap="xs">
                <h2 className="text-sm font-semibold">Settings</h2>
                {isBoardOnly && (
                  <Badge size="xs" variant="light" color="cyan">
                    Board Only
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                {isBoardOnly
                  ? 'Board essentials first. Advanced settings remain available.'
                  : 'Workspace configuration and governance.'}
              </Text>
            </div>
            <nav
              className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pr-1"
              role="tablist"
              aria-orientation="vertical"
              onKeyDown={handleKeyDown}
            >
              <Stack gap="sm">
                {SETTINGS_NAVIGATION_GROUPS.map((group) => (
                  <div
                    key={group.id}
                    role="group"
                    aria-labelledby={`settings-group-${group.id}`}
                    data-settings-nav-group={group.id}
                  >
                    <Text
                      id={`settings-group-${group.id}`}
                      size="xs"
                      c="dimmed"
                      fw={700}
                      tt="uppercase"
                      px="xs"
                      mb={3}
                    >
                      {group.label}
                    </Text>
                    <Stack gap={2}>
                      {group.tabs.map((tab) => {
                        const Icon = tab.icon;
                        const allowed = canUseTab(tab);
                        const active = activeTab === tab.id;
                        const advancedInBoardOnly = isBoardOnly && !tab.boardOnlyPrimary;
                        return (
                          <Button
                            key={tab.id}
                            id={`tab-${tab.id}`}
                            ref={tab.id === 'general' ? firstTabButtonRef : undefined}
                            type="button"
                            role="tab"
                            aria-label={tab.label}
                            aria-selected={active}
                            aria-controls="settings-tab-content"
                            tabIndex={active ? 0 : -1}
                            onClick={() => setActiveTab(tab.id)}
                            disabled={!allowed}
                            title={
                              allowed ? tab.label : `${tab.requiredPermission} permission required`
                            }
                            variant={active ? 'light' : 'subtle'}
                            color={active ? 'violet' : 'gray'}
                            size="xs"
                            radius="md"
                            fullWidth
                            justify="flex-start"
                            leftSection={<Icon className="h-4 w-4 flex-shrink-0" />}
                            data-board-only-priority={advancedInBoardOnly ? 'advanced' : 'primary'}
                          >
                            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                              <span className="truncate">{tab.label}</span>
                              {advancedInBoardOnly && (
                                <span
                                  className="rounded bg-muted px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground"
                                  aria-hidden="true"
                                >
                                  Advanced
                                </span>
                              )}
                            </span>
                          </Button>
                        );
                      })}
                    </Stack>
                  </div>
                ))}
              </Stack>
            </nav>

            {/* Import/Export/Reset */}
            <Stack gap="sm" className="mt-auto shrink-0 border-t px-3 pt-3 pb-6">
              <input
                ref={settingsFileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportSettings}
                className="hidden"
                aria-label="Import settings file"
              />
              <SettingsActionGroup label="Transfer">
                <Button
                  type="button"
                  onClick={handleExportSettings}
                  aria-label="Export settings as JSON file"
                  variant="subtle"
                  color="gray"
                  size="xs"
                  fullWidth
                  justify="flex-start"
                  leftSection={
                    <Download className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  }
                >
                  Export Settings
                </Button>
                <Button
                  type="button"
                  onClick={() => settingsFileInputRef.current?.click()}
                  disabled={!canWriteSettings}
                  aria-label="Import settings from JSON file"
                  variant="subtle"
                  color="gray"
                  size="xs"
                  fullWidth
                  justify="flex-start"
                  leftSection={<Upload className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />}
                >
                  Import Settings
                </Button>
              </SettingsActionGroup>
              <SettingsActionGroup label="Danger zone" tone="danger">
                <Button
                  type="button"
                  disabled={!canWriteSettings}
                  variant="subtle"
                  color="red"
                  size="xs"
                  fullWidth
                  justify="flex-start"
                  leftSection={<RotateCcw className="h-3.5 w-3.5 flex-shrink-0" />}
                  onClick={() => setResetAllOpen(true)}
                >
                  Reset All
                </Button>
              </SettingsActionGroup>
            </Stack>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div data-settings-mobile-header className="shrink-0 border-b px-4 py-3 sm:hidden">
              <h2 className="text-lg font-semibold">Settings</h2>
              <Select
                value={activeTab}
                onChange={(value) => {
                  if (value) setActiveTab(value as TabId);
                }}
                data={mobileTabOptions}
                aria-label="Select settings section"
                size="sm"
                checkIconPosition="right"
                className="mt-3 w-full"
                styles={{ input: { minHeight: '2.75rem' } }}
              />
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div
                id="settings-tab-content"
                ref={contentAreaRef}
                className="mx-auto w-full max-w-3xl px-4 py-4 focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 sm:px-6 sm:py-6"
                role="tabpanel"
                tabIndex={-1}
                aria-labelledby={`tab-${activeTab}`}
              >
                {renderTab()}
              </div>
            </ScrollArea>
          </div>
        </div>
      </ErrorBoundary>
      <Modal
        opened={resetAllOpen}
        onClose={() => setResetAllOpen(false)}
        title="Reset all settings?"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This will reset ALL feature settings across every section back to their default values.
            This cannot be undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setResetAllOpen(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleResetAll}>
              Reset Everything
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
}
