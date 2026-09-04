import { UiModal as Modal, OverlayFooter } from '@/components/ui/UiOverlay';
import { UiPill, UiAction, UiIconAction } from '@/components/ui/UiVocabulary';
import { useState, useRef, useCallback, lazy, Suspense, useEffect, useMemo } from 'react';
import { Group, Menu, Select, Skeleton, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { useIdentity } from '@/hooks/useIdentity';
import { useToast } from '@/hooks/useToast';
import {
  Settings2,
  MoreHorizontal,
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
      { id: 'general', label: 'General', icon: Settings2 },
      { id: 'board', label: 'Board', icon: Layout },
      { id: 'tasks', label: 'Tasks', icon: ListTodo },
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
  // Only mount the visible navigation: CSS-hidden controls are still counted
  // by the focus trap while a lazy tab has no controls of its own.
  const showSidebar = useMediaQuery('(min-width: 40em)');
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
          label: tab.label,
          disabled: !canUseTab(tab),
        })),
      })),
    [canUseTab]
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
  const keyboardTabChange = useRef(false);
  const [resetAllOpen, setResetAllOpen] = useState(false);

  // Focus content area when switching tabs
  useEffect(() => {
    if (contentAreaRef.current) {
      if (keyboardTabChange.current) {
        dialogContentRef.current?.querySelector<HTMLButtonElement>(`#tab-${activeTab}`)?.focus();
        keyboardTabChange.current = false;
      } else {
        contentAreaRef.current.focus();
      }
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
        keyboardTabChange.current = true;
        const next = (currentIndex + 1) % availableTabs.length;
        setActiveTab(availableTabs[next].id);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        keyboardTabChange.current = true;
        const prev = (currentIndex - 1 + availableTabs.length) % availableTabs.length;
        setActiveTab(availableTabs[prev].id);
      }
    },
    [activeTab, canUseTab]
  );

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
      variant="authoring"
      compound
      opened={open}
      onClose={() => onOpenChange(false)}
      title={
        <Group gap="xs" wrap="nowrap">
          <Text component="span" size="sm" fw={600}>
            Settings
          </Text>
          {isBoardOnly && <UiPill>Board Only</UiPill>}
        </Group>
      }
      centered
      trapFocus
      returnFocus
      closeButtonProps={{ 'aria-label': 'Close settings' }}
      classNames={{
        content: 'settings-dialog-content h-dvh',
        header: 'settings-dialog-header',
        body: 'settings-dialog-body',
      }}
    >
      <ErrorBoundary level="section">
        <div ref={dialogContentRef} className="settings-dialog flex h-full min-h-0">
          <input
            ref={settingsFileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportSettings}
            className="hidden"
            tabIndex={-1}
            aria-label="Import settings file"
          />
          {showSidebar && (
            <div className="flex min-h-0 w-56 shrink-0 flex-col border-r bg-muted/25 py-4">
              <div className="px-4 pb-3">
                <Text size="xs" c="dimmed" mt={4}>
                  Workspace preferences and controls.
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
                          return (
                            <UiAction
                              variant="quiet"
                              className="settings-nav-action"
                              key={tab.id}
                              id={`tab-${tab.id}`}
                              type="button"
                              role="tab"
                              aria-label={tab.label}
                              aria-selected={active}
                              aria-controls="settings-tab-content"
                              tabIndex={active ? 0 : -1}
                              onClick={() => setActiveTab(tab.id)}
                              disabled={!allowed}
                              title={
                                allowed
                                  ? tab.label
                                  : `${tab.requiredPermission} permission required`
                              }
                              fullWidth
                              justify="flex-start"
                              leftSection={<Icon className="h-4 w-4 flex-shrink-0" />}
                            >
                              <span className="min-w-0 whitespace-normal text-left">
                                {tab.label}
                              </span>
                            </UiAction>
                          );
                        })}
                      </Stack>
                    </div>
                  ))}
                </Stack>
              </nav>

              {/* Import/Export/Reset */}
              <Stack gap="sm" className="mt-auto shrink-0 border-t px-3 pt-3 pb-6">
                <SettingsActionGroup label="Transfer">
                  <UiAction
                    variant="quiet"
                    type="button"
                    onClick={handleExportSettings}
                    aria-label="Export settings as JSON file"
                    fullWidth
                    justify="flex-start"
                    leftSection={
                      <Download className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    }
                  >
                    Export Settings
                  </UiAction>
                  <UiAction
                    variant="quiet"
                    type="button"
                    onClick={() => settingsFileInputRef.current?.click()}
                    disabled={!canWriteSettings}
                    aria-label="Import settings from JSON file"
                    fullWidth
                    justify="flex-start"
                    leftSection={
                      <Upload className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    }
                  >
                    Import Settings
                  </UiAction>
                </SettingsActionGroup>
                <SettingsActionGroup label="Danger zone" tone="danger">
                  <UiAction
                    variant="quiet"
                    type="button"
                    disabled={!canWriteSettings}
                    fullWidth
                    justify="flex-start"
                    leftSection={<RotateCcw className="h-3.5 w-3.5 flex-shrink-0" />}
                    onClick={() => setResetAllOpen(true)}
                  >
                    Reset All
                  </UiAction>
                </SettingsActionGroup>
              </Stack>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {!showSidebar && (
              <div
                data-settings-mobile-header
                className="flex items-center gap-2 shrink-0 border-b px-4 py-3"
              >
                <Select
                  value={activeTab}
                  onChange={(value) => {
                    if (value) setActiveTab(value as TabId);
                  }}
                  data={mobileTabOptions}
                  aria-label="Select settings section"
                  size="sm"
                  checkIconPosition="right"
                  className="min-w-0 flex-1 w-full"
                  styles={{ input: { minHeight: '2.75rem' } }}
                />
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <UiIconAction aria-label="Settings actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </UiIconAction>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>Transfer</Menu.Label>
                    <Menu.Item leftSection={<Download size={16} />} onClick={handleExportSettings}>
                      Export Settings
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<Upload size={16} />}
                      disabled={!canWriteSettings}
                      onClick={() => settingsFileInputRef.current?.click()}
                    >
                      Import Settings
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Label>Danger zone</Menu.Label>
                    <Menu.Item
                      color="red"
                      leftSection={<RotateCcw size={16} />}
                      disabled={!canWriteSettings}
                      onClick={() => setResetAllOpen(true)}
                    >
                      Reset All
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </div>
            )}
            <div className="vk-overlay-scroll" data-settings-content-scroll>
              <div
                id="settings-tab-content"
                ref={contentAreaRef}
                className="mx-auto w-full max-w-3xl focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
                role="tabpanel"
                tabIndex={-1}
                aria-labelledby={showSidebar ? `tab-${activeTab}` : undefined}
                aria-label={
                  showSidebar ? undefined : TABS.find((tab) => tab.id === activeTab)?.label
                }
              >
                {renderTab()}
              </div>
            </div>
          </div>
        </div>
      </ErrorBoundary>
      <Modal
        variant="confirm"
        compound
        opened={resetAllOpen}
        onClose={() => setResetAllOpen(false)}
        title="Reset all settings?"
        centered
      >
        <Stack gap="1rem" className="vk-overlay-scroll">
          <Text size="sm" c="dimmed">
            This will reset ALL feature settings across every section back to their default values.
            This cannot be undone.
          </Text>
        </Stack>
        <OverlayFooter>
          <UiAction variant="quiet" data-autofocus onClick={() => setResetAllOpen(false)}>
            Cancel
          </UiAction>
          <UiAction variant="destructive" onClick={handleResetAll}>
            Reset Everything
          </UiAction>
        </OverlayFooter>
      </Modal>
    </Modal>
  );
}
