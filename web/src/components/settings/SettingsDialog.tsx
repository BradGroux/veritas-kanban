import { useState, useRef, useCallback, lazy, Suspense, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { useToast } from '@/hooks/useToast';
import {
  Settings2,
  Layout,
  ListTodo,
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
} from 'lucide-react';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';
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

// ============ Tab Skeleton ============

function TabSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-32" />
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
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
  | 'manage';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const TABS: TabDef[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'board', label: 'Board', icon: Layout },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'agents', label: 'Agents', icon: Cpu },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'delegation', label: 'Delegation', icon: Plane },
  { id: 'tool-policies', label: 'Tool Policies', icon: Lock },
  { id: 'enforcement', label: 'Enforcement', icon: CheckCircle2 },
  { id: 'shared-resources', label: 'Shared Resources', icon: Boxes },
  { id: 'doc-freshness', label: 'Doc Freshness', icon: BookOpen },
  { id: 'manage', label: 'Manage', icon: Archive },
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

  // Set active tab when defaultTab changes
  useEffect(() => {
    if (defaultTab && TABS.some((t) => t.id === defaultTab)) {
      setActiveTab(defaultTab as TabId);
    }
  }, [defaultTab]);
  const { settings: currentSettings } = useFeatureSettings();
  const { debouncedUpdate } = useDebouncedFeatureUpdate();
  const settingsFileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const firstTabButtonRef = useRef<HTMLButtonElement>(null);

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
      const validPatch: Record<string, any> = {};
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
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = TABS.findIndex((t) => t.id === activeTab);
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = (currentIndex + 1) % TABS.length;
        setActiveTab(TABS[next].id);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = (currentIndex - 1 + TABS.length) % TABS.length;
        setActiveTab(TABS[prev].id);
      }
    },
    [activeTab]
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
      </Suspense>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] h-[85vh] p-0 overflow-hidden">
        <ErrorBoundary level="section">
          <div className="flex h-full min-h-0">
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
                {TABS.map((tab, index) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      id={`tab-${tab.id}`}
                      ref={index === 0 ? firstTabButtonRef : undefined}
                      role="tab"
                      aria-selected={activeTab === tab.id}
                      aria-controls="settings-tab-content"
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

              {/* Import/Export/Reset */}
              <div className="px-2 pt-3 mt-auto border-t space-y-1">
                <input
                  ref={settingsFileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportSettings}
                  className="hidden"
                  aria-label="Import settings file"
                />
                <button
                  onClick={handleExportSettings}
                  aria-label="Export settings as JSON file"
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-background/50 hover:text-foreground transition-colors text-left"
                >
                  <Download className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  Export Settings
                </button>
                <button
                  onClick={() => settingsFileInputRef.current?.click()}
                  aria-label="Import settings from JSON file"
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-background/50 hover:text-foreground transition-colors text-left"
                >
                  <Upload className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  Import Settings
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs text-red-400 hover:bg-red-500/10 transition-colors text-left">
                      <RotateCcw className="h-3.5 w-3.5 flex-shrink-0" />
                      Reset All
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will reset ALL feature settings across every section back to their
                        default values. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleResetAll}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Reset Everything
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            {/* Mobile Tab Selector */}
            <div className="sm:hidden absolute top-3 right-12">
              <Select value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
                <SelectTrigger className="w-36 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TABS.map((tab) => (
                    <SelectItem key={tab.id} value={tab.id}>
                      {tab.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              <DialogHeader className="px-6 py-4 border-b sm:hidden">
                <DialogTitle>Settings</DialogTitle>
              </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}
