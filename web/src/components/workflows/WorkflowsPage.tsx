/**
 * WorkflowsPage - Browse and manage workflows
 *
 * Features:
 * - List all workflows with metadata
 * - Start workflow runs
 * - View active runs per workflow
 * - Empty state when no workflows exist
 */

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Search, Play, Users, ListOrdered, BarChart3 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkflowRunList } from './WorkflowRunList';
import { WorkflowDashboard } from './WorkflowDashboard';

interface WorkflowsPageProps {
  onBack: () => void;
}

interface Workflow {
  id: string;
  name: string;
  version: number;
  description: string;
  agents: Array<{ id: string; name: string; role: string }>;
  steps: Array<{ id: string; name: string }>;
  activeRunCount?: number;
}

export function WorkflowsPage({ onBack }: WorkflowsPageProps) {
  const [search, setSearch] = useState('');
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const { toast } = useToast();

  // Fetch workflows on mount
  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        const response = await fetch('/api/workflows');
        if (!response.ok) throw new Error('Failed to fetch workflows');
        const json = await response.json();
        setWorkflows(json.data ?? json);
      } catch (error) {
        toast({
          title: '❌ Failed to load workflows',
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchWorkflows();
  }, [toast]);

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
      const response = await fetch(`/api/workflows/${workflowId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) throw new Error('Failed to start workflow run');

      const run = await response.json();
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Board
          </Button>
          <h1 className="text-2xl font-bold">Workflows</h1>
          <Badge variant="secondary">{filteredWorkflows.length} workflows</Badge>
        </div>

        <Button onClick={() => setShowDashboard(true)}>
          <BarChart3 className="h-4 w-4 mr-2" />
          Dashboard
        </Button>
      </div>

      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search workflows..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Workflow List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search ? 'No workflows match your search' : 'No workflows available'}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredWorkflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              onStartRun={() => handleStartRun(workflow.id)}
              onViewRuns={() => setSelectedWorkflowId(workflow.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface WorkflowCardProps {
  workflow: Workflow;
  onStartRun: () => void;
  onViewRuns: () => void;
}

function WorkflowCard({ workflow, onStartRun, onViewRuns }: WorkflowCardProps) {
  return (
    <div className="p-6 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-semibold text-lg">{workflow.name}</h3>
            <Badge variant="outline" className="text-xs">
              v{workflow.version}
            </Badge>
            {workflow.activeRunCount !== undefined && workflow.activeRunCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {workflow.activeRunCount} active run{workflow.activeRunCount !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          <p className="text-sm text-muted-foreground mb-4 whitespace-pre-wrap">
            {workflow.description}
          </p>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              <span>{workflow.agents.length} agents</span>
            </div>
            <div className="flex items-center gap-1">
              <ListOrdered className="h-4 w-4" />
              <span>{workflow.steps.length} steps</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <Button size="sm" onClick={onStartRun}>
            <Play className="h-3 w-3 mr-1" />
            Start Run
          </Button>
          {workflow.activeRunCount !== undefined && workflow.activeRunCount > 0 && (
            <Button size="sm" variant="outline" onClick={onViewRuns}>
              View Runs
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
