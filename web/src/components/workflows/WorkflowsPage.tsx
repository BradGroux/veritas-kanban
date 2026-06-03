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

import { useState, useMemo, useEffect, useCallback } from 'react';
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
} from '@mantine/core';
import { ArrowLeft, Search, Play, Users, ListOrdered, BarChart3 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { WorkflowRunList } from './WorkflowRunList';
import { WorkflowDashboard } from './WorkflowDashboard';
import { WorkflowAuthoringPanel } from './WorkflowAuthoringPanel';
import { useIdentity } from '@/hooks/useIdentity';
import { workflowsApi, type WorkflowSummary } from '@/lib/api/workflows';

interface WorkflowsPageProps {
  onBack: () => void;
}

export function WorkflowsPage({ onBack }: WorkflowsPageProps) {
  const [search, setSearch] = useState('');
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>('browse');
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

  const handleStartRun = async (workflowId: string) => {
    try {
      if (!canExecuteWorkflows) {
        throw new Error('Workflow execute permission required');
      }
      const run = await workflowsApi.startRun(workflowId);
      toast({
        title: 'Workflow run started',
        description: `Run ID: ${run.id}`,
      });

      // Open the run view
      setSelectedWorkflowId(workflowId);
    } catch (error) {
      toast({
        title: '❌ Failed to start workflow run',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  if (showDashboard) {
    return <WorkflowDashboard onBack={() => setShowDashboard(false)} />;
  }

  if (selectedWorkflowId) {
    return (
      <WorkflowRunList workflowId={selectedWorkflowId} onBack={() => setSelectedWorkflowId(null)} />
    );
  }

  return (
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
            Back to Board
          </Button>
          <Title order={1} className="text-2xl">
            Workflows
          </Title>
          <Badge variant="light">{filteredWorkflows.length} workflows</Badge>
        </Group>

        <Button
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
                    onStartRun={() => handleStartRun(workflow.id)}
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
            onWorkflowCreated={() => {
              void fetchWorkflows();
              setActiveTab('browse');
            }}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

interface WorkflowCardProps {
  workflow: WorkflowSummary;
  onStartRun: () => void;
  onViewRuns: () => void;
  canStartRun: boolean;
}

function WorkflowCard({ workflow, onStartRun, onViewRuns, canStartRun }: WorkflowCardProps) {
  return (
    <Paper className="p-6 transition-colors hover:bg-accent/50" radius="md" withBorder>
      <Group align="flex-start" justify="space-between" gap="md">
        <div className="flex-1 min-w-0">
          <Group gap="sm" mb="xs">
            <Title order={3} className="text-lg">
              {workflow.name}
            </Title>
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
            onClick={onStartRun}
            disabled={!canStartRun}
            title={canStartRun ? 'Start run' : 'Workflow execute permission required'}
            leftSection={<Play className="h-3 w-3" />}
          >
            Start Run
          </Button>
          {workflow.activeRunCount !== undefined && workflow.activeRunCount > 0 && (
            <Button size="sm" variant="outline" onClick={onViewRuns}>
              View Runs
            </Button>
          )}
        </Stack>
      </Group>
    </Paper>
  );
}
