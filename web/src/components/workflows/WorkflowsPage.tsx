/**
 * WorkflowsPage - Browse and manage workflows
 *
 * Features:
 * - List all workflows with metadata
 * - Start workflow runs
 * - Author recipes, visual definitions, dry-runs, and YAML
 * - View active runs per workflow
 * - Empty state when no workflows exist
 */

import { lazy, Suspense, useState, useMemo, useEffect, useCallback } from 'react';
import type { WorkflowDefinition } from '@veritas-kanban/shared';
import {
  Badge,
  Button,
  Group,
  Paper,
  Skeleton,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { ArrowLeft, Search, Play, Users, ListOrdered, BarChart3, Eye } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { WorkflowRunList } from './WorkflowRunList';
import { WorkflowAuthoringPanel } from './WorkflowAuthoringPanel';
import { useIdentity } from '@/hooks/useIdentity';
import { workflowsApi, type WorkflowSummary } from '@/lib/api/workflows';
import { WorkflowDetailView } from './WorkflowDetailView';
import { WorkflowEditorRoute } from './WorkflowEditorRoute';
import { WorkflowStartDialog } from './WorkflowStartDialog';

const WorkflowDashboard = lazy(() =>
  import('./WorkflowDashboard').then((mod) => ({ default: mod.WorkflowDashboard }))
);

interface WorkflowsPageProps {
  onBack: () => void;
}

type WorkflowRoute =
  | { kind: 'browse' }
  | { kind: 'view'; workflowId: string }
  | { kind: 'edit'; workflowId: string }
  | { kind: 'duplicate'; workflowId: string };

const WORKFLOW_ROUTE_STATE_KEY = 'veritasWorkflowNavigation';
const appBasePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

function workflowBasePath(): string {
  return `${appBasePath}/workflows`.replace(/\/+/g, '/');
}

function workflowRouteFromLocation(): WorkflowRoute {
  if (typeof window === 'undefined') return { kind: 'browse' };
  const base = workflowBasePath();
  const normalized = window.location.pathname.replace(/\/+$/, '') || '/';
  if (normalized === base) return { kind: 'browse' };
  if (!normalized.startsWith(`${base}/`)) return { kind: 'browse' };

  const segments = normalized.slice(base.length + 1).split('/');
  if (!segments[0]) return { kind: 'browse' };
  let workflowId: string;
  try {
    workflowId = decodeURIComponent(segments[0]);
  } catch {
    return { kind: 'browse' };
  }
  if (segments[1] === 'edit') return { kind: 'edit', workflowId };
  if (segments[1] === 'duplicate') return { kind: 'duplicate', workflowId };
  return { kind: 'view', workflowId };
}

function workflowRoutePath(route: WorkflowRoute): string {
  const base = workflowBasePath();
  if (route.kind === 'browse') return base;
  const workflowPath = `${base}/${encodeURIComponent(route.workflowId)}`;
  if (route.kind === 'edit') return `${workflowPath}/edit`;
  if (route.kind === 'duplicate') return `${workflowPath}/duplicate`;
  return workflowPath;
}

function hasWorkflowHistoryOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const state = window.history.state;
  return Boolean(
    state &&
    typeof state === 'object' &&
    (state as Record<string, unknown>)[WORKFLOW_ROUTE_STATE_KEY]
  );
}

export function WorkflowsPage({ onBack }: WorkflowsPageProps) {
  const [search, setSearch] = useState('');
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>('browse');
  const [workflowRoute, setWorkflowRoute] = useState<WorkflowRoute>(workflowRouteFromLocation);
  const [workflowToStart, setWorkflowToStart] = useState<WorkflowDefinition | null>(null);
  const { toast } = useToast();
  const { hasPermission } = useIdentity();
  const canExecuteWorkflows = hasPermission('workflow:execute');
  const canWriteWorkflows = hasPermission('workflow:write');

  const fetchWorkflows = useCallback(async () => {
    setIsLoading(true);
    try {
      const json = await workflowsApi.list();
      setWorkflows(json);
    } catch (error) {
      toast({
        title: 'Failed to load workflows',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // Fetch workflows on mount
  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);

  useEffect(() => {
    const handlePopState = () => {
      setWorkflowRoute(workflowRouteFromLocation());
      setSelectedWorkflowId(null);
      setShowDashboard(false);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateWorkflowRoute = useCallback(
    (nextRoute: WorkflowRoute, options: { replace?: boolean } = {}) => {
      const nextPath = workflowRoutePath(nextRoute);
      const state: Record<string, unknown> =
        window.history.state && typeof window.history.state === 'object'
          ? { ...(window.history.state as Record<string, unknown>) }
          : {};
      if (!options.replace) {
        state[WORKFLOW_ROUTE_STATE_KEY] = { from: window.location.pathname };
      }
      if (options.replace) {
        window.history.replaceState(state, '', nextPath);
      } else {
        window.history.pushState(state, '', nextPath);
      }
      setWorkflowRoute(nextRoute);
      setSelectedWorkflowId(null);
      setShowDashboard(false);
    },
    []
  );

  const backFromWorkflowRoute = useCallback(
    (fallback: WorkflowRoute) => {
      if (hasWorkflowHistoryOrigin()) {
        window.history.back();
        return;
      }
      navigateWorkflowRoute(fallback, { replace: true });
    },
    [navigateWorkflowRoute]
  );

  // Filter workflows
  const filteredWorkflows = useMemo(() => {
    return workflows.filter(
      (workflow) =>
        search === '' ||
        workflow.name.toLowerCase().includes(search.toLowerCase()) ||
        workflow.description.toLowerCase().includes(search.toLowerCase()) ||
        workflow.id.toLowerCase().includes(search.toLowerCase())
    );
  }, [workflows, search]);

  const handleStartRun = (workflow: WorkflowDefinition) => {
    if (!canExecuteWorkflows) {
      toast({
        title: 'Workflow execute permission required',
        description: 'The current identity cannot start workflow runs.',
      });
      return;
    }
    setWorkflowToStart(workflow);
  };

  if (showDashboard) {
    return (
      <Suspense
        fallback={
          <Stack gap="md">
            <Skeleton h={36} w={240} />
            <Skeleton h={160} />
            <Skeleton h={240} />
          </Stack>
        }
      >
        <WorkflowDashboard onBack={() => setShowDashboard(false)} />
      </Suspense>
    );
  }

  if (selectedWorkflowId) {
    return (
      <WorkflowRunList workflowId={selectedWorkflowId} onBack={() => setSelectedWorkflowId(null)} />
    );
  }

  if (workflowRoute.kind === 'view') {
    return (
      <>
        <WorkflowDetailView
          workflowId={workflowRoute.workflowId}
          canWriteWorkflows={canWriteWorkflows}
          canExecuteWorkflows={canExecuteWorkflows}
          onBack={() => backFromWorkflowRoute({ kind: 'browse' })}
          onEdit={() =>
            navigateWorkflowRoute({ kind: 'edit', workflowId: workflowRoute.workflowId })
          }
          onDuplicate={() =>
            navigateWorkflowRoute({ kind: 'duplicate', workflowId: workflowRoute.workflowId })
          }
          onStartRun={handleStartRun}
          onViewRuns={() => setSelectedWorkflowId(workflowRoute.workflowId)}
        />
        <WorkflowStartDialog
          workflow={workflowToStart}
          onClose={() => setWorkflowToStart(null)}
          onStarted={(run) => {
            setWorkflowToStart(null);
            toast({
              title: 'Workflow run started',
              description: `Run ID: ${run.id}`,
            });
            setSelectedWorkflowId(workflowRoute.workflowId);
          }}
        />
      </>
    );
  }

  if (workflowRoute.kind === 'edit' || workflowRoute.kind === 'duplicate') {
    const sourceWorkflowId = workflowRoute.workflowId;
    return (
      <WorkflowEditorRoute
        sourceWorkflowId={sourceWorkflowId}
        mode={workflowRoute.kind}
        canWriteWorkflows={canWriteWorkflows}
        onBack={() => backFromWorkflowRoute({ kind: 'view', workflowId: sourceWorkflowId })}
        onDuplicate={() =>
          navigateWorkflowRoute(
            { kind: 'duplicate', workflowId: sourceWorkflowId },
            { replace: true }
          )
        }
        onSaved={(workflowId) => {
          void fetchWorkflows();
          if (workflowRoute.kind === 'edit') {
            backFromWorkflowRoute({ kind: 'view', workflowId });
          } else {
            navigateWorkflowRoute({ kind: 'view', workflowId }, { replace: true });
          }
        }}
      />
    );
  }

  return (
    <>
      <Stack gap="lg">
        {/* Header */}
        <Group justify="space-between" align="center">
          <Group gap="md" align="center">
            <Button
              variant="subtle"
              size="sm"
              leftSection={<ArrowLeft className="h-4 w-4" />}
              onClick={onBack}
            >
              Back
            </Button>
            <Title order={1} className="text-2xl">
              Workflows
            </Title>
            <Badge variant="light">{filteredWorkflows.length} workflows</Badge>
          </Group>

          <Button
            variant="filled"
            color="veritas"
            size="sm"
            leftSection={<BarChart3 className="h-4 w-4" />}
            onClick={() => setShowDashboard(true)}
          >
            Dashboard
          </Button>
        </Group>

        <Tabs value={activeTab} onChange={setActiveTab} className="w-full">
          <Tabs.List className="w-fit">
            <Tabs.Tab value="browse">Browse</Tabs.Tab>
            <Tabs.Tab value="author">Author</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="browse" pt="md">
            <Stack gap="md">
              {/* Search */}
              <TextInput
                className="max-w-md"
                leftSection={<Search className="h-4 w-4" />}
                placeholder="Search workflows..."
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />

              {/* Workflow List */}
              {isLoading ? (
                <Stack gap="sm">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} h={128} />
                  ))}
                </Stack>
              ) : filteredWorkflows.length === 0 ? (
                <Text ta="center" c="dimmed" py="xl">
                  {search ? 'No workflows match your search' : 'No workflows available'}
                </Text>
              ) : (
                <Stack gap="md">
                  {filteredWorkflows.map((workflow) => (
                    <WorkflowCard
                      key={workflow.id}
                      workflow={workflow}
                      onViewDetails={() =>
                        navigateWorkflowRoute({ kind: 'view', workflowId: workflow.id })
                      }
                      onStartRun={async () => {
                        try {
                          const definition = await workflowsApi.get(workflow.id);
                          handleStartRun(definition);
                        } catch (error) {
                          toast({
                            title: 'Workflow unavailable',
                            description: error instanceof Error ? error.message : 'Unknown error',
                          });
                        }
                      }}
                      onViewRuns={() => setSelectedWorkflowId(workflow.id)}
                      canStartRun={canExecuteWorkflows}
                    />
                  ))}
                </Stack>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="author" pt="md">
            <WorkflowAuthoringPanel
              canSaveWorkflow={canWriteWorkflows}
              onWorkflowCreated={(workflowId) => {
                void fetchWorkflows();
                setActiveTab('browse');
                navigateWorkflowRoute({ kind: 'view', workflowId });
              }}
            />
          </Tabs.Panel>
        </Tabs>
      </Stack>
      <WorkflowStartDialog
        workflow={workflowToStart}
        onClose={() => setWorkflowToStart(null)}
        onStarted={(run) => {
          const workflowId = workflowToStart?.id;
          setWorkflowToStart(null);
          toast({
            title: 'Workflow run started',
            description: `Run ID: ${run.id}`,
          });
          if (workflowId) setSelectedWorkflowId(workflowId);
        }}
      />
    </>
  );
}

interface WorkflowCardProps {
  workflow: WorkflowSummary;
  onViewDetails: () => void;
  onStartRun: () => void;
  onViewRuns: () => void;
  canStartRun: boolean;
}

function WorkflowCard({
  workflow,
  onViewDetails,
  onStartRun,
  onViewRuns,
  canStartRun,
}: WorkflowCardProps) {
  return (
    <Paper className="p-6 transition-colors hover:bg-accent/50" radius="md" withBorder>
      <Group align="flex-start" justify="space-between" gap="md">
        <div className="flex-1 min-w-0">
          <Group gap="sm" mb="xs">
            <UnstyledButton
              onClick={onViewDetails}
              aria-label={`View ${workflow.name}`}
              className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Title order={3} className="text-lg">
                {workflow.name}
              </Title>
            </UnstyledButton>
            <Badge variant="outline" className="text-xs">
              v{workflow.version}
            </Badge>
            {workflow.activeRunCount !== undefined && workflow.activeRunCount > 0 && (
              <Badge variant="light" className="text-xs">
                {workflow.activeRunCount} active run{workflow.activeRunCount !== 1 ? 's' : ''}
              </Badge>
            )}
          </Group>

          <Text size="sm" c="dimmed" mb="md" className="whitespace-pre-wrap">
            {workflow.description}
          </Text>

          <Group gap="md" className="text-sm text-muted-foreground">
            <Group gap={4}>
              <Users className="h-4 w-4" />
              <span>{workflow.agents?.length ?? 0} agents</span>
            </Group>
            <Group gap={4}>
              <ListOrdered className="h-4 w-4" />
              <span>{workflow.steps?.length ?? 0} steps</span>
            </Group>
          </Group>
        </div>

        <Stack gap="xs" className="shrink-0">
          <Button
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onStartRun();
            }}
            disabled={!canStartRun}
            title={canStartRun ? 'Start run' : 'Workflow execute permission required'}
            leftSection={<Play className="h-3 w-3" />}
          >
            Start Run
          </Button>
          <Button
            size="sm"
            variant="subtle"
            leftSection={<Eye className="h-3 w-3" />}
            onClick={(event) => {
              event.stopPropagation();
              onViewDetails();
            }}
          >
            View details
          </Button>
          {workflow.activeRunCount !== undefined && workflow.activeRunCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation();
                onViewRuns();
              }}
            >
              View Runs
            </Button>
          )}
        </Stack>
      </Group>
    </Paper>
  );
}
