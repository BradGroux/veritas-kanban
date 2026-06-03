import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bell,
  Bot,
  CalendarClock,
  FileClock,
  FileText,
  History,
  Loader2,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Wrench,
  Workflow,
} from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  api,
  type SearchBackend,
  type SearchCollection,
  type SearchResponse,
  type SearchResult,
  type SearchTarget,
} from '@/lib/api';
import { extractTaskId } from '@/lib/search-utils';
import { cn } from '@/lib/utils';
import { VIEW_BY_ID, type AppView } from '@/lib/views';
import type {
  TaskDetailNavigationTarget,
  TaskDetailTabId,
} from '@/components/task/TaskDetailPanel';

const COLLECTIONS: { id: SearchCollection; label: string }[] = [
  { id: 'tasks-active', label: 'Active' },
  { id: 'tasks-archive', label: 'Archive' },
  { id: 'tasks-backlog', label: 'Backlog' },
  { id: 'docs', label: 'Docs' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'work-products', label: 'Work Products' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'workflow-runs', label: 'Workflow Runs' },
  { id: 'policies', label: 'Policies' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'settings', label: 'Settings' },
  { id: 'logs-diagnostics', label: 'Logs' },
  { id: 'agent-runs', label: 'Agent Runs' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'scheduled-runs', label: 'Scheduled Runs' },
];

const COLLECTION_LABELS = new Map(
  COLLECTIONS.map((collection) => [collection.id, collection.label])
);

const ALL_COLLECTION_IDS = COLLECTIONS.map((collection) => collection.id);

const BACKENDS: { id: SearchBackend; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'keyword', label: 'Keyword' },
  { id: 'qmd', label: 'QMD' },
];

const TASK_DETAIL_TABS = new Set<TaskDetailTabId>([
  'work',
  'details',
  'progress',
  'work-products',
  'observations',
  'attachments',
  'git',
  'agent',
  'timeline',
  'changes',
  'review',
  'metrics',
]);

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTaskOpen?: (taskId: string, target?: TaskDetailNavigationTarget) => void;
  onViewOpen?: (view: AppView) => void;
  onSettingsOpen?: (section?: string) => void;
  onDiagnosticsOpen?: () => void;
  initialQuery?: string;
  initialCollections?: SearchCollection[];
}

function collectionIcon(collection: string) {
  if (collection === 'docs' || collection === 'prompts') return FileText;
  if (collection === 'tasks-archive') return Archive;
  if (collection === 'work-products') return Sparkles;
  if (collection === 'workflows') return Workflow;
  if (collection === 'workflow-runs') return History;
  if (collection === 'policies') return ShieldAlert;
  if (collection === 'settings') return Settings;
  if (collection === 'logs-diagnostics') return FileClock;
  if (collection === 'agent-runs') return Bot;
  if (collection === 'notifications') return Bell;
  if (collection === 'maintenance') return Wrench;
  if (collection === 'scheduled-runs') return CalendarClock;
  return Search;
}

function collectionLabel(collection: string) {
  return COLLECTION_LABELS.get(collection as SearchCollection) ?? collection;
}

function isAppView(value: string | undefined): value is AppView {
  return Boolean(value && value in VIEW_BY_ID);
}

function taskNavigationTarget(target: SearchTarget): TaskDetailNavigationTarget | undefined {
  if (target.type !== 'task') return undefined;
  const tab = TASK_DETAIL_TABS.has(target.tab as TaskDetailTabId)
    ? (target.tab as TaskDetailTabId)
    : undefined;

  if (!tab && !target.timelineAttemptId) return undefined;

  return {
    tab,
    timelineAttemptId: target.timelineAttemptId ?? null,
  };
}

function targetForResult(result: SearchResult): SearchTarget {
  const metadataTarget = result.metadata?.target;
  if (metadataTarget?.type) return metadataTarget;

  if (result.collection.startsWith('tasks')) {
    const taskId = extractTaskId(result.path);
    if (taskId) {
      return {
        type: 'task',
        taskId,
        href: `veritas://task/${encodeURIComponent(taskId)}`,
      };
    }
  }

  return {
    type: 'none',
    disabledReason: 'This result does not have an in-app destination yet.',
  };
}

function actionLabel(target: SearchTarget, result: SearchResult) {
  const primaryAction = result.metadata?.actions?.find((action) => !action.disabledReason);
  if (primaryAction?.label) return primaryAction.label;

  if (target.type === 'task') return target.tab === 'timeline' ? 'Open timeline' : 'Open task';
  if (target.type === 'view') return 'Open view';
  if (target.type === 'settings') return 'Open settings';
  if (target.type === 'diagnostics') return 'Open diagnostics';
  if (target.type === 'url') return 'Open link';
  return 'Unavailable';
}

export function SearchDialog({
  open,
  onOpenChange,
  onTaskOpen,
  onViewOpen,
  onSettingsOpen,
  onDiagnosticsOpen,
  initialQuery,
  initialCollections,
}: SearchDialogProps) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [backend, setBackend] = useState<SearchBackend>('auto');
  const [collections, setCollections] = useState<SearchCollection[]>(
    initialCollections?.length ? initialCollections : ALL_COLLECTION_IDS
  );
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery ?? '');
    setCollections(initialCollections?.length ? initialCollections : ALL_COLLECTION_IDS);
    setResponse(null);
    setError(null);
  }, [initialCollections, initialQuery, open]);

  const trimmedQuery = query.trim();
  const canSearch = trimmedQuery.length > 0 && collections.length > 0 && !isSearching;

  const resultCount = response?.results.length ?? 0;
  const statusLabel = useMemo(() => {
    if (!response) return null;
    const noun = resultCount === 1 ? 'result' : 'results';
    return `${resultCount} ${noun} from ${response.backend}`;
  }, [response, resultCount]);

  const groupedResults = useMemo(() => {
    if (!response) return [];

    const groups: Array<{ collection: string; results: SearchResult[] }> = [];
    const byCollection = new Map<string, SearchResult[]>();
    for (const result of response.results) {
      const existing = byCollection.get(result.collection);
      if (existing) {
        existing.push(result);
      } else {
        const next = [result];
        byCollection.set(result.collection, next);
        groups.push({ collection: result.collection, results: next });
      }
    }

    return groups;
  }, [response]);

  const runSearch = async () => {
    if (!canSearch) return;

    setIsSearching(true);
    setError(null);
    try {
      const nextResponse = await api.search.query({
        query: trimmedQuery,
        backend,
        collections,
        limit: 20,
      });
      setResponse(nextResponse);
    } catch (err) {
      setResponse(null);
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const toggleCollection = (collection: SearchCollection, checked: boolean) => {
    setCollections((current) => {
      if (checked) return Array.from(new Set([...current, collection]));
      return current.filter((item) => item !== collection);
    });
  };

  const openTarget = (target: SearchTarget) => {
    if (target.type === 'task') {
      onTaskOpen?.(target.taskId, taskNavigationTarget(target));
      onOpenChange(false);
      return;
    }

    if (target.type === 'view' && isAppView(target.view)) {
      onViewOpen?.(target.view);
      onOpenChange(false);
      return;
    }

    if (target.type === 'settings') {
      if (onSettingsOpen) {
        onSettingsOpen(target.section);
      } else {
        window.dispatchEvent(
          new CustomEvent('veritas:open-settings', { detail: { section: target.section } })
        );
      }
      onOpenChange(false);
      return;
    }

    if (target.type === 'diagnostics') {
      if (onDiagnosticsOpen) {
        onDiagnosticsOpen();
      } else {
        window.dispatchEvent(new CustomEvent('veritas:open-diagnostics'));
      }
      onOpenChange(false);
      return;
    }

    if (target.type === 'url' && target.href) {
      window.open(target.href, '_blank', 'noopener,noreferrer');
      onOpenChange(false);
    }
  };

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      size="xl"
      padding={0}
      title={
        <Group gap="xs">
          <span className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            Universal Search
          </span>
        </Group>
      }
      classNames={{ header: 'border-b px-5 py-4', body: 'p-0' }}
    >
      <Stack gap="md" className="px-5 py-4">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <TextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks, runs, policies, settings..."
              aria-label="Search Veritas"
              leftSection={<Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              autoFocus
            />
          </div>
          <Select
            value={backend}
            onChange={(value) => setBackend((value ?? 'auto') as SearchBackend)}
            data={BACKENDS.map((item) => ({ value: item.id, label: item.label }))}
            aria-label="Search backend"
            className="w-full sm:w-32"
            allowDeselect={false}
          />
          <Button
            type="submit"
            disabled={!canSearch}
            leftSection={
              isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="h-4 w-4" aria-hidden="true" />
              )
            }
          >
            Search
          </Button>
        </form>

        <div className="flex max-h-28 flex-wrap items-center gap-2 overflow-y-auto pr-1">
          {COLLECTIONS.map((collection) => (
            <Checkbox
              key={collection.id}
              checked={collections.includes(collection.id)}
              onChange={(event) => toggleCollection(collection.id, event.currentTarget.checked)}
              label={collection.label}
              className="flex h-8 items-center rounded-md border px-3"
              classNames={{ label: 'text-sm font-normal' }}
            />
          ))}
          {response?.degraded && (
            <Badge
              variant="outline"
              color="yellow"
              leftSection={<ShieldAlert className="h-3 w-3" aria-hidden="true" />}
            >
              Fallback
            </Badge>
          )}
          {statusLabel && <span className="text-sm text-muted-foreground">{statusLabel}</span>}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <ScrollArea h={500} className="rounded-md border">
          {!response && !error ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No search has run yet.
            </div>
          ) : response && response.results.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No matches found.
            </div>
          ) : (
            groupedResults.map((group) => (
              <div key={group.collection}>
                <div className="sticky top-0 z-10 border-b bg-card/95 px-4 py-2 backdrop-blur">
                  <Text size="xs" fw={700} c="dimmed" tt="uppercase" className="tracking-wider">
                    {collectionLabel(group.collection)}
                  </Text>
                </div>
                {group.results.map((result, index) => {
                  const Icon = collectionIcon(result.collection);
                  const target = targetForResult(result);
                  const actionable = target.type !== 'none';

                  return (
                    <button
                      key={`${result.collection}:${result.id}:${index}`}
                      type="button"
                      disabled={!actionable}
                      title={!actionable ? target.disabledReason : actionLabel(target, result)}
                      className={cn(
                        'flex w-full gap-3 border-b px-4 py-3 text-left transition-colors',
                        actionable ? 'hover:bg-muted/60' : 'cursor-not-allowed opacity-70'
                      )}
                      onClick={() => {
                        if (!actionable) return;
                        openTarget(target);
                      }}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{result.title}</span>
                          <Badge variant="light" color="gray">
                            {collectionLabel(result.collection)}
                          </Badge>
                          <Badge variant={actionable ? 'outline' : 'light'} color="gray">
                            {actionLabel(target, result)}
                          </Badge>
                        </span>
                        <span className="mt-1 block break-all text-xs text-muted-foreground">
                          {result.path}
                        </span>
                        {result.snippet && (
                          <span className="mt-2 block text-sm leading-6 text-muted-foreground">
                            {result.snippet}
                          </span>
                        )}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {Number(result.score).toFixed(2)}
                      </span>
                    </button>
                  );
                })}
                <Divider />
              </div>
            ))
          )}
        </ScrollArea>

        {response?.degraded && response.reason && (
          <p className="text-xs text-muted-foreground">{response.reason}</p>
        )}
      </Stack>
    </Modal>
  );
}

export { extractTaskId };
