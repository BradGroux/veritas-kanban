import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, ShieldAlert, BrainCircuit, Route, ShieldCheck } from 'lucide-react';
import { Badge, Button, SegmentedControl, Select, TextInput } from '@mantine/core';
import { useDecisions } from '@/hooks/useDecisions';
import { useGovernanceTraces } from '@/hooks/useGovernanceTraces';
import type {
  DecisionListFilters,
  DecisionRecord,
  GovernanceTraceKind,
  GovernanceTraceListFilters,
  GovernanceTraceOutcome,
  GovernanceTraceRecord,
} from '@veritas-kanban/shared';
import { DecisionDetail } from './DecisionDetail';
import { GovernanceTraceDetail } from './GovernanceTraceDetail';

interface DecisionExplorerProps {
  onBack: () => void;
}

const BASE_PATH = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

type ExplorerMode = 'decisions' | 'governance';

const traceKindOptions: Array<{ value: 'all' | GovernanceTraceKind; label: string }> = [
  { value: 'all', label: 'All trace types' },
  { value: 'policy', label: 'Policies' },
  { value: 'tool-policy', label: 'Tool policies' },
  { value: 'budget-policy', label: 'Budget policies' },
  { value: 'agent-permission', label: 'Agent permissions' },
  { value: 'routing', label: 'Routing' },
  { value: 'workflow-gate', label: 'Workflow gates' },
];

const traceOutcomeOptions: Array<{ value: 'all' | GovernanceTraceOutcome; label: string }> = [
  { value: 'all', label: 'All outcomes' },
  { value: 'allowed', label: 'Allowed' },
  { value: 'warned', label: 'Warned' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'approval-required', label: 'Approval required' },
  { value: 'routed', label: 'Routed' },
  { value: 'fallback', label: 'Fallback' },
  { value: 'skipped', label: 'Skipped' },
];

function riskColor(riskScore: number): string {
  if (riskScore >= 75) return 'red';
  if (riskScore >= 40) return 'yellow';
  return 'green';
}

function traceOutcomeColor(outcome: GovernanceTraceOutcome): string {
  if (outcome === 'blocked') return 'red';
  if (outcome === 'approval-required') return 'orange';
  if (outcome === 'warned' || outcome === 'fallback') return 'yellow';
  if (outcome === 'allowed' || outcome === 'routed') return 'green';
  return 'gray';
}

export function DecisionExplorer({ onBack }: DecisionExplorerProps) {
  const initialParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const initialSelectedId = initialParams?.get('decision') ?? null;
  const initialTraceId = initialParams?.get('trace') ?? null;
  const initialMode = initialParams?.get('mode') === 'governance' ? 'governance' : 'decisions';
  const initialSearch = initialParams?.get('q') ?? '';

  const [mode, setMode] = useState<ExplorerMode>(initialTraceId ? 'governance' : initialMode);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(initialTraceId);
  const [agent, setAgent] = useState('all');
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [traceKind, setTraceKind] = useState<'all' | GovernanceTraceKind>('all');
  const [traceOutcome, setTraceOutcome] = useState<'all' | GovernanceTraceOutcome>('all');
  const [search, setSearch] = useState(initialSearch);

  const filters = useMemo<DecisionListFilters>(() => {
    const next: DecisionListFilters = {};
    if (agent !== 'all') next.agent = agent;
    if (confidenceFilter === 'high') next.minConfidence = 80;
    if (confidenceFilter === 'medium') {
      next.minConfidence = 50;
      next.maxConfidence = 79;
    }
    if (confidenceFilter === 'low') next.maxConfidence = 49;
    if (riskFilter === 'high') next.minRisk = 70;
    if (riskFilter === 'medium') {
      next.minRisk = 40;
      next.maxRisk = 69;
    }
    if (riskFilter === 'low') next.maxRisk = 39;
    return next;
  }, [agent, confidenceFilter, riskFilter]);

  const traceFilters = useMemo<GovernanceTraceListFilters>(() => {
    const next: GovernanceTraceListFilters = { limit: 200 };
    if (traceKind !== 'all') next.kind = traceKind;
    if (traceOutcome !== 'all') next.outcome = traceOutcome;
    return next;
  }, [traceKind, traceOutcome]);

  const { data: decisions = [], isLoading } = useDecisions(filters);
  const { data: traces = [], isLoading: tracesLoading } = useGovernanceTraces(traceFilters);

  const filteredDecisions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return decisions;
    return decisions.filter((decision) =>
      [decision.id, decision.agentId, decision.taskId, decision.inputContext, decision.outputAction]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [decisions, search]);

  const filteredTraces = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return traces;
    return traces.filter((trace) =>
      [
        trace.id,
        trace.kind,
        trace.outcome,
        trace.title,
        trace.summary,
        trace.subject.agentId,
        trace.subject.actorId,
        trace.subject.role,
        trace.subject.taskId,
        trace.subject.workflowId,
        trace.subject.runId,
        trace.subject.stepId,
        trace.subject.actionType,
        trace.subject.tool,
        trace.subject.project,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [traces, search]);

  const agentOptions = useMemo(
    () => Array.from(new Set(decisions.map((decision) => decision.agentId))).sort(),
    [decisions]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (selectedId) {
      params.set('decision', selectedId);
      params.delete('trace');
    } else {
      params.delete('decision');
    }
    if (selectedTraceId) {
      params.set('trace', selectedTraceId);
      params.delete('decision');
    } else {
      params.delete('trace');
    }
    if (mode === 'governance') {
      params.set('mode', 'governance');
    } else {
      params.delete('mode');
    }
    if (search.trim()) {
      params.set('q', search.trim());
    } else {
      params.delete('q');
    }
    const query = params.toString();
    window.history.replaceState({}, '', `${BASE_PATH}/decisions${query ? `?${query}` : ''}`);
  }, [mode, search, selectedId, selectedTraceId]);

  const handleModeChange = (value: string) => {
    setMode(value as ExplorerMode);
    setSelectedId(null);
    setSelectedTraceId(null);
    setSearch('');
  };

  if (selectedId && mode === 'decisions') {
    return <DecisionDetail decisionId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  if (selectedTraceId && mode === 'governance') {
    return (
      <GovernanceTraceDetail traceId={selectedTraceId} onBack={() => setSelectedTraceId(null)} />
    );
  }

  const activeCount = mode === 'decisions' ? filteredDecisions.length : filteredTraces.length;
  const activeLabel = mode === 'decisions' ? 'decisions' : 'traces';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="subtle" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Board
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Decision Audit Trail</h1>
            <p className="text-sm text-muted-foreground">
              Review agent reasoning, policy decisions, and workflow gate outcomes.
            </p>
          </div>
        </div>
        <Badge variant="light" tt="none">
          {activeCount} {activeLabel}
        </Badge>
      </div>

      <SegmentedControl
        value={mode}
        onChange={handleModeChange}
        data={[
          { value: 'decisions', label: 'Agent Decisions' },
          { value: 'governance', label: 'Governance Traces' },
        ]}
      />

      <div
        className={
          mode === 'decisions'
            ? 'grid gap-4 lg:grid-cols-[1.2fr_220px_220px_220px]'
            : 'grid gap-4 lg:grid-cols-[1.2fr_220px_220px]'
        }
      >
        <div>
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              mode === 'decisions'
                ? 'Search decision id, task, context...'
                : 'Search trace id, rule, action, subject...'
            }
            leftSection={<Search className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

        {mode === 'decisions' ? (
          <>
            <Select
              value={agent}
              onChange={(value) => setAgent(value ?? 'all')}
              data={[
                { value: 'all', label: 'All agents' },
                ...agentOptions.map((option) => ({ value: option, label: option })),
              ]}
              placeholder="All agents"
              allowDeselect={false}
            />

            <Select
              value={confidenceFilter}
              onChange={(value) => setConfidenceFilter(value ?? 'all')}
              data={[
                { value: 'all', label: 'All confidence' },
                { value: 'high', label: '80-100' },
                { value: 'medium', label: '50-79' },
                { value: 'low', label: '0-49' },
              ]}
              placeholder="Confidence"
              allowDeselect={false}
            />

            <Select
              value={riskFilter}
              onChange={(value) => setRiskFilter(value ?? 'all')}
              data={[
                { value: 'all', label: 'All risk' },
                { value: 'low', label: '0-39' },
                { value: 'medium', label: '40-69' },
                { value: 'high', label: '70-100' },
              ]}
              placeholder="Risk"
              allowDeselect={false}
            />
          </>
        ) : (
          <>
            <Select
              value={traceKind}
              onChange={(value) => setTraceKind((value ?? 'all') as 'all' | GovernanceTraceKind)}
              data={traceKindOptions}
              placeholder="Trace type"
              allowDeselect={false}
            />

            <Select
              value={traceOutcome}
              onChange={(value) =>
                setTraceOutcome((value ?? 'all') as 'all' | GovernanceTraceOutcome)
              }
              data={traceOutcomeOptions}
              placeholder="Outcome"
              allowDeselect={false}
            />
          </>
        )}
      </div>

      {mode === 'decisions' ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="grid grid-cols-[1.5fr_1.1fr_120px_120px_150px_180px] gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Action</span>
            <span>Agent / Task</span>
            <span>Confidence</span>
            <span>Risk</span>
            <span>Assumptions</span>
            <span>Timestamp</span>
          </div>

          {isLoading ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Loading decisions...
            </div>
          ) : filteredDecisions.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No decisions match the current filters.
            </div>
          ) : (
            filteredDecisions.map((decision) => (
              <DecisionRow
                key={decision.id}
                decision={decision}
                onOpen={() => setSelectedId(decision.id)}
              />
            ))
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="grid grid-cols-[1.5fr_150px_150px_170px_180px] gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Trace</span>
            <span>Type</span>
            <span>Outcome</span>
            <span>Subject</span>
            <span>Timestamp</span>
          </div>

          {tracesLoading ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Loading governance traces...
            </div>
          ) : filteredTraces.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No governance traces match the current filters.
            </div>
          ) : (
            filteredTraces.map((trace) => (
              <GovernanceTraceRow
                key={trace.id}
                trace={trace}
                onOpen={() => setSelectedTraceId(trace.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function GovernanceTraceRow({
  trace,
  onOpen,
}: {
  trace: GovernanceTraceRecord;
  onOpen: () => void;
}) {
  const subject =
    trace.subject.agentId ||
    trace.subject.actorId ||
    trace.subject.role ||
    trace.subject.taskId ||
    trace.subject.workflowId ||
    trace.subject.runId ||
    trace.subject.actionType ||
    'local';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[1.5fr_150px_150px_170px_180px] gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/40"
    >
      <div>
        <div className="font-medium">{trace.title}</div>
        <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{trace.summary}</div>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Route className="h-4 w-4 text-muted-foreground" />
        <span>{trace.kind}</span>
      </div>
      <div>
        <Badge
          color={traceOutcomeColor(trace.outcome)}
          variant="light"
          tt="none"
          leftSection={<ShieldCheck className="h-3 w-3" />}
        >
          {trace.outcome}
        </Badge>
      </div>
      <div className="space-y-1 text-sm">
        <div className="font-medium">{subject}</div>
        <div className="text-muted-foreground">{trace.subject.actionType}</div>
      </div>
      <div className="text-sm text-muted-foreground">
        {new Date(trace.createdAt).toLocaleString()}
      </div>
    </button>
  );
}

function DecisionRow({ decision, onOpen }: { decision: DecisionRecord; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[1.5fr_1.1fr_120px_120px_150px_180px] gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/40"
    >
      <div>
        <div className="font-medium">{decision.outputAction}</div>
        <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {decision.inputContext}
        </div>
      </div>
      <div className="space-y-1 text-sm">
        <div className="font-medium">{decision.agentId}</div>
        <div className="text-muted-foreground">{decision.taskId}</div>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <BrainCircuit className="h-4 w-4 text-muted-foreground" />
        <span>{decision.confidenceLevel}%</span>
      </div>
      <div>
        <Badge
          color={riskColor(decision.riskScore)}
          variant="light"
          tt="none"
          leftSection={<ShieldAlert className="h-3 w-3" />}
        >
          {decision.riskScore}
        </Badge>
      </div>
      <div className="text-sm text-muted-foreground">{decision.assumptions.length}</div>
      <div className="text-sm text-muted-foreground">
        {new Date(decision.timestamp).toLocaleString()}
      </div>
    </button>
  );
}
