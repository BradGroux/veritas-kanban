import { useState, useRef, useCallback, lazy, Suspense, useEffect, useMemo } from 'react';
import { Button, Group, Modal, ScrollArea, Select, Skeleton, Stack, Text } from '@mantine/core';
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
} from 'lucide-react';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import type { ClientAuthPermission } from '@veritas-kanban/shared';
import { SettingsErrorBoundary } from './shared';
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
  | 'maintenance'
  | 'manage';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ElementType;
  requiredPermission?: ClientAuthPermission;
}

const TABS: TabDef[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'board', label: 'Board', icon: Layout },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'agents', label: 'Agents', icon: Cpu, requiredPermission: 'agent:read' },
  { id: 'data', label: 'Data', icon: Database, requiredPermission: 'backup:read' },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security', icon: Shield, requiredPermission: 'settings:read' },
  { id: 'multi-user', label: 'Multi-user', icon: UserCog, requiredPermission: 'workspace:read' },
  {
    id: 'workspace-capabilities',
    label: 'Workspaces',
    icon: Network,
    requiredPermission: 'workspace:read',
  },
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
  { id: 'maintenance', label: 'Maintenance', icon: Wrench, requiredPermission: 'backup:read' },
  { id: 'delegation', label: 'Delegation', icon: Plane, requiredPermission: 'agent:read' },
  { id: 'tool-policies', label: 'Tool Policies', icon: Lock, requiredPermission: 'policy:read' },
  {
    id: 'enforcement',
    label: 'Enforcement',
    icon: CheckCircle2,
    requiredPermission: 'policy:read',
  },
  { id: 'shared-resources', label: 'Shared Resources', icon: Boxes },
  { id: 'doc-freshness', label: 'Doc Freshness', icon: BookOpen },
  { id: 'manage', label: 'Manage', icon: Archive, requiredPermission: 'backup:read' },
];

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
  const canWriteSettings = hasPermission('settings:write');
  const canUseTab = useCallback(
    (tab: TabDef) => !tab.requiredPermission || hasPermission(tab.requiredPermission),
    [hasPermission]
  );
  const mobileTabOptions = useMemo(
    () =>
      TABS.map((tab) => ({
        value: tab.id,
        label: tab.label,
        disabled: !canUseTab(tab),
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
  const { settings: currentSettings } = useFeatureSettings();
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
      size={800}
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
          <div className="hidden min-h-0 w-48 flex-col border-r bg-muted/30 py-4 sm:flex">
            <div className="px-4 pb-3">
              <h2 className="text-sm font-semibold">Settings</h2>
            </div>
            <nav
              className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pr-1"
              role="tablist"
              aria-orientation="vertical"
              onKeyDown={handleKeyDown}
            >
              <Stack gap={4}>
                {TABS.map((tab, index) => {
                  const Icon = tab.icon;
                  const allowed = canUseTab(tab);
                  const active = activeTab === tab.id;
                  return (
                    <Button
                      key={tab.id}
                      id={`tab-${tab.id}`}
                      ref={index === 0 ? firstTabButtonRef : undefined}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-controls="settings-tab-content"
                      tabIndex={active ? 0 : -1}
                      onClick={() => setActiveTab(tab.id)}
                      disabled={!allowed}
                      title={allowed ? tab.label : `${tab.requiredPermission} permission required`}
                      variant={active ? 'light' : 'subtle'}
                      color={active ? 'violet' : 'gray'}
                      size="xs"
                      radius="md"
                      fullWidth
                      justify="flex-start"
                      leftSection={<Icon className="h-4 w-4 flex-shrink-0" />}
                    >
                      {tab.label}
                    </Button>
                  );
                })}
              </Stack>
            </nav>

            {/* Import/Export/Reset */}
            <Stack gap={4} className="mt-auto shrink-0 border-t px-3 pt-3 pb-6">
              <input
                ref={settingsFileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportSettings}
                className="hidden"
                aria-label="Import settings file"
              />
              <Button
                type="button"
                onClick={handleExportSettings}
                aria-label="Export settings as JSON file"
                variant="subtle"
                color="gray"
                size="xs"
                fullWidth
                justify="flex-start"
                leftSection={<Download className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />}
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
            </Stack>
          </div>

          {/* Mobile Tab Selector */}
          <div className="sm:hidden absolute top-3 right-12">
            <Select
              value={activeTab}
              onChange={(value) => {
                if (value) setActiveTab(value as TabId);
              }}
              data={mobileTabOptions}
              aria-label="Select settings section"
              size="sm"
              checkIconPosition="right"
              className="w-40"
              styles={{ input: { minHeight: '2rem' } }}
            />
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="px-6 py-4 border-b sm:hidden">
              <h2 className="text-lg font-semibold">Settings</h2>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div
                id="settings-tab-content"
                ref={contentAreaRef}
                className="px-6 py-4"
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
