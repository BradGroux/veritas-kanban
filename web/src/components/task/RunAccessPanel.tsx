import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { FolderLock, Gauge, KeyRound, ShieldCheck, Wifi, Wrench } from 'lucide-react';
import type {
  PhaseName,
  RunAccessChangeInput,
  RunAccessChangePreview,
  RunAccessSummary,
} from '@veritas-kanban/shared';
import {
  useAgentAccess,
  useApplyRunAccessChange,
  usePreviewRunAccessChange,
} from '@/hooks/useAgent';

interface RunAccessPanelProps {
  taskId: string;
  attemptId: string;
  live?: boolean;
}

const STATUS_COLOR: Record<RunAccessSummary['status'], string> = {
  complete: 'green',
  incomplete: 'yellow',
  blocked: 'red',
};

export function RunAccessPanel({ taskId, attemptId, live = false }: RunAccessPanelProps) {
  const query = useAgentAccess(taskId, attemptId, live);
  const previewChange = usePreviewRunAccessChange();
  const applyChange = useApplyRunAccessChange();
  const versions = useMemo(
    () => (query.data ? [query.data.current, ...query.data.history] : []),
    [query.data]
  );
  const currentSequence = query.data?.current.version.sequence;
  const [sequence, setSequence] = useState<string>('');
  const [targetPhase, setTargetPhase] = useState<PhaseName>('verify');
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState(() => newAccessRequestId());
  const [preview, setPreview] = useState<RunAccessChangePreview>();
  const [approvalId, setApprovalId] = useState<string>();

  useEffect(() => {
    setSequence(currentSequence === undefined ? '' : String(currentSequence));
  }, [attemptId, currentSequence]);

  useEffect(() => {
    setRequestId(newAccessRequestId());
    setPreview(undefined);
    setApprovalId(undefined);
  }, [attemptId]);

  if (query.isLoading) {
    return (
      <Paper withBorder p="md" radius="md" aria-label="Run Access">
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm">Loading Run Access</Text>
        </Group>
      </Paper>
    );
  }
  if (query.error || !query.data) {
    return (
      <Paper withBorder p="md" radius="md" aria-label="Run Access">
        <Text fw={700}>Run Access</Text>
        <Text size="sm" c="red">
          {query.error instanceof Error
            ? query.error.message
            : 'Run access evidence is unavailable.'}
        </Text>
      </Paper>
    );
  }

  const summary =
    versions.find((candidate) => String(candidate.version.sequence) === sequence) ??
    query.data.current;
  const phase = summary.identity.phase;
  const phaseLabel = phase?.mode === 'profile' ? phase.phase : (phase?.phase ?? 'unavailable');
  const current = query.data.current;
  const canChange =
    live &&
    summary.version.sequence === current.version.sequence &&
    current.identity.phaseEvidenceDigest !== null &&
    current.identity.launchManifestDigest !== null;
  const changeInput = (): RunAccessChangeInput => ({
    attemptId,
    requestId,
    operation: 'transition-phase',
    targetPhase,
    reason,
    expectedAccessSummaryDigest: current.digest,
    expectedSequence: current.identity.transitionSequence,
    expectedPhaseEvidenceDigest: current.identity.phaseEvidenceDigest as string,
    expectedManifestDigest: current.identity.launchManifestDigest as string,
  });
  const resetPreview = () => {
    setPreview(undefined);
    setApprovalId(undefined);
    setRequestId(newAccessRequestId());
  };

  return (
    <Paper withBorder p="md" radius="md" aria-label="Run Access">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" gap="sm">
          <div>
            <Group gap="xs">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <Text fw={700}>Run Access</Text>
              <Badge color={STATUS_COLOR[summary.status]} variant="light">
                {summary.status}
              </Badge>
              <Badge variant="outline">{phaseLabel}</Badge>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              Attempt {summary.identity.attemptId} · sequence {summary.version.sequence} ·{' '}
              {summary.identity.selectedHost ?? 'host unavailable'}
            </Text>
          </div>
          {versions.length > 1 && (
            <Select
              label="Access version"
              aria-label="Access version"
              size="xs"
              value={String(summary.version.sequence)}
              onChange={(value) =>
                setSequence(value ?? String(query.data.current.version.sequence))
              }
              data={versions.map((version) => ({
                value: String(version.version.sequence),
                label:
                  version.version.sequence === query.data.current.version.sequence
                    ? `Current · #${version.version.sequence}`
                    : `Prior · #${version.version.sequence}`,
              }))}
            />
          )}
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="xs">
          <AccessMetric
            icon={FolderLock}
            label="Filesystem"
            value={`${summary.filesystem.sandboxMode} · ${summary.filesystem.targets.length} scope${summary.filesystem.targets.length === 1 ? '' : 's'}`}
          />
          <AccessMetric
            icon={Wifi}
            label="Network"
            value={`${summary.network.policy} · ${summary.network.enforceability}`}
          />
          <AccessMetric
            icon={Wrench}
            label="Tools"
            value={`${summary.tools.filter((tool) => tool.decision === 'allow').length} allow · ${summary.approvals.toolCount} approve · ${summary.tools.filter((tool) => tool.decision === 'deny').length} deny`}
          />
          <AccessMetric
            icon={KeyRound}
            label="Integrations"
            value={`${summary.integrations.filter((item) => item.state === 'brokered').length} brokered · ${summary.integrations.filter((item) => item.state !== 'brokered').length} unavailable`}
          />
        </SimpleGrid>

        {summary.blockers.length > 0 && (
          <Stack gap={4} role="status" aria-label="Run access blockers">
            {summary.blockers.map((blocker) => (
              <Text key={`${blocker.code}:${blocker.source?.digest ?? ''}`} size="xs" c="red">
                {blocker.code}: {blocker.message}
              </Text>
            ))}
          </Stack>
        )}

        <Accordion variant="contained">
          <Accordion.Item value="effective-access">
            <Accordion.Control>Effective scopes and decisions</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <Text size="xs" fw={600}>
                  Filesystem
                </Text>
                <Group gap="xs" wrap="wrap">
                  {summary.filesystem.targets.map((target) => (
                    <Badge
                      key={`${target.label}:${target.pathDigest ?? target.scope}`}
                      variant="outline"
                    >
                      {target.label}: {target.access} · {target.enforceability}
                    </Badge>
                  ))}
                </Group>
                <Text size="xs" fw={600}>
                  Tools
                </Text>
                <Group gap="xs" wrap="wrap">
                  {summary.tools.map((tool) => (
                    <Badge
                      key={`${tool.server}:${tool.qualifiedName}`}
                      color={
                        tool.decision === 'deny'
                          ? 'red'
                          : tool.decision === 'approval'
                            ? 'yellow'
                            : 'green'
                      }
                      variant="light"
                    >
                      {tool.qualifiedName}: {tool.decision}
                    </Badge>
                  ))}
                </Group>
                <Text size="xs" fw={600}>
                  Integrations and targets
                </Text>
                {summary.integrations.map((integration) => (
                  <Text key={integration.definition} size="xs">
                    {integration.accountLabel}: {integration.state}
                    {integration.externalTargets.length > 0
                      ? ` · ${integration.externalTargets.join(', ')}`
                      : ''}
                    {integration.expiresAt
                      ? ` · expires ${new Date(integration.expiresAt).toLocaleString()}`
                      : ''}
                  </Text>
                ))}
                <Group gap="xs">
                  <Gauge className="h-3 w-3" aria-hidden="true" />
                  <Text size="xs">
                    Reservation {summary.budgets.reservationState}
                    {summary.budgets.capacity
                      ? ` · ${summary.budgets.capacity.runSlots} run slot · ${summary.budgets.capacity.processSlots} process slot`
                      : ''}
                  </Text>
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="sources">
            <Accordion.Control>Evidence sources</Accordion.Control>
            <Accordion.Panel>
              <Stack gap={4}>
                {summary.sources.map((source) => (
                  <Group
                    key={`${source.kind}:${source.recordId}:${source.digest}`}
                    gap="xs"
                    wrap="nowrap"
                  >
                    <Badge
                      size="xs"
                      color={
                        source.state === 'verified'
                          ? 'green'
                          : source.state === 'conflict'
                            ? 'red'
                            : 'yellow'
                      }
                    >
                      {source.state}
                    </Badge>
                    <Text size="xs" className="min-w-0" truncate>
                      {source.kind} · {source.recordId}
                    </Text>
                    <Code className="ml-auto">{source.digest.slice(0, 19)}</Code>
                  </Group>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>

        {canChange && (
          <>
            <Divider />
            <Stack gap="xs" aria-label="Change Run Access">
              <Text fw={600} size="sm">
                Change active access
              </Text>
              <Text size="xs" c="dimmed">
                Preview a server-owned authority diff. Changes that the active provider cannot apply
                atomically stop at a relaunch boundary.
              </Text>
              <Select
                label="Target phase"
                value={targetPhase}
                data={['explore', 'plan', 'implement', 'verify', 'publish']}
                onChange={(value) => {
                  setTargetPhase((value ?? 'verify') as PhaseName);
                  resetPreview();
                }}
              />
              <Textarea
                label="Reason"
                value={reason}
                minRows={2}
                maxLength={20_000}
                onChange={(event) => {
                  setReason(event.currentTarget.value);
                  resetPreview();
                }}
              />
              <Group gap="xs">
                <Button
                  variant="light"
                  loading={previewChange.isPending}
                  disabled={reason.trim().length === 0}
                  onClick={() =>
                    previewChange.mutate(
                      { taskId, request: changeInput() },
                      { onSuccess: setPreview }
                    )
                  }
                >
                  Preview change
                </Button>
                {preview?.enforcement.state === 'ready' && (
                  <Button
                    loading={applyChange.isPending}
                    onClick={() =>
                      applyChange.mutate(
                        {
                          taskId,
                          request: {
                            ...changeInput(),
                            requestRevision: preview.requestRevision,
                            approvalId,
                          },
                        },
                        {
                          onSuccess: (result) => {
                            setPreview(result.preview);
                            setApprovalId(result.transition.approval?.id);
                          },
                        }
                      )
                    }
                  >
                    Apply reviewed change
                  </Button>
                )}
              </Group>
              {(previewChange.error || applyChange.error) && (
                <Alert color="red" title="Run Access change failed">
                  {(previewChange.error ?? applyChange.error)?.message}
                </Alert>
              )}
              {preview && (
                <Alert
                  color={preview.enforcement.state === 'ready' ? 'blue' : 'yellow'}
                  title={
                    preview.enforcement.state === 'ready'
                      ? `Reviewed ${preview.authorityDelta.classification} change`
                      : 'Relaunch or provider change required'
                  }
                >
                  <Stack gap={4}>
                    {preview.authorityDelta.entries.map((entry) => (
                      <Text size="xs" key={entry.dimension}>
                        {entry.dimension}: +{entry.addedScopes.join(', ') || 'none'} · −
                        {entry.removedScopes.join(', ') || 'none'}
                      </Text>
                    ))}
                    {preview.enforcement.blockers.map((blocker) => (
                      <Text size="xs" key={blocker.code}>
                        {blocker.code}: {blocker.message}
                      </Text>
                    ))}
                    <Text size="xs">
                      Budget impact: {preview.budgetImpact.classification} · reservation{' '}
                      {preview.budgetImpact.after.reservationState}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Revision {preview.requestRevision}
                    </Text>
                    {approvalId && (
                      <Text size="xs">
                        Approval {approvalId} is pending. Decide it in Run Approvals, then retry
                        this exact change.
                      </Text>
                    )}
                  </Stack>
                </Alert>
              )}
            </Stack>
          </>
        )}
      </Stack>
    </Paper>
  );
}

function newAccessRequestId(): string {
  return `access-${crypto.randomUUID()}`;
}

function AccessMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FolderLock;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <Group gap="xs" wrap="nowrap">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <Text size="xs" c="dimmed">
            {label}
          </Text>
          <Text size="sm" fw={600} truncate>
            {value}
          </Text>
        </div>
      </Group>
    </div>
  );
}
