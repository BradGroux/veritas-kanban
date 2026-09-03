import { UiAction, semanticToneForLegacyColor, UiPill } from '@/components/ui/UiVocabulary';
import { SettingsGroup, SettingsNotice } from '@/components/settings/shared/SettingsLayout';
import { useState } from 'react';
import { Group, Loader, SimpleGrid, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { CheckCircle2, Pause, Play, RefreshCw, RotateCw } from 'lucide-react';
import type {
  AutomationDraft,
  AutomationDraftHints,
  AutomationActivationPreview,
  SchedulerEvent,
  SchedulerItem,
  SchedulerRunStatus,
} from '@veritas-kanban/shared';
import { useIdentity } from '@/hooks/useIdentity';
import { SettingsPage, SettingsSection } from '../shared';
import {
  useAutomationDraftPreview,
  useAutomationDraftSave,
  useAutomationDrafts,
  useAutomationActivationApply,
  useAutomationActivationPreview,
  useScheduler,
  useSchedulerPause,
  useSchedulerResume,
  useSchedulerRunDue,
  useSchedulerRunItem,
  useSchedulerValidate,
} from '@/hooks/useScheduler';
import { useToast } from '@/hooks/useToast';

const EMPTY_ITEMS: SchedulerItem[] = [];
const EMPTY_EVENTS: SchedulerEvent[] = [];

export function SchedulerTab() {
  const { hasPermission } = useIdentity();
  const { toast } = useToast();
  const scheduler = useScheduler();
  const drafts = useAutomationDrafts();
  const previewDraft = useAutomationDraftPreview();
  const saveDraft = useAutomationDraftSave();
  const previewActivation = useAutomationActivationPreview();
  const applyActivation = useAutomationActivationApply();
  const [intent, setIntent] = useState('');
  const [hintsJson, setHintsJson] = useState('{}');
  const [draftPreview, setDraftPreview] = useState<AutomationDraft | null>(null);
  const [activationPreview, setActivationPreview] = useState<AutomationActivationPreview | null>(
    null
  );
  const [activationApprovalId, setActivationApprovalId] = useState<string>();
  const [requestId] = useState(
    () => `automation-ui-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`
  );
  const runDue = useSchedulerRunDue();
  const runItem = useSchedulerRunItem();
  const pause = useSchedulerPause();
  const resume = useSchedulerResume();
  const validate = useSchedulerValidate();
  const canExecute = hasPermission('workflow:execute');
  const canWrite = hasPermission('workflow:write');
  const items = scheduler.data?.items ?? EMPTY_ITEMS;
  const events = scheduler.data?.recentEvents ?? EMPTY_EVENTS;

  const mutate = async (action: () => Promise<unknown>, successTitle: string) => {
    try {
      await action();
      toast({ title: successTitle });
    } catch (error) {
      toast({
        title: 'Scheduler action failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const compileDraft = async (save: boolean) => {
    try {
      const hints = parseDraftHints(hintsJson);
      const result = await (save ? saveDraft : previewDraft).mutateAsync({
        intent,
        requestId,
        hints,
      });
      setDraftPreview(result);
      toast({
        title: save ? 'Inactive automation draft saved' : 'Automation draft preview compiled',
      });
    } catch (error) {
      toast({
        title: 'Automation draft failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const reviewActivation = async (draft: AutomationDraft) => {
    try {
      const preview = await previewActivation.mutateAsync({
        draftId: draft.id,
        revision: draft.revision,
        requestId: `activation-ui-${draft.id}-${draft.revision}`,
      });
      setActivationPreview(preview);
      setActivationApprovalId(undefined);
      toast({ title: 'Standing authority preview compiled' });
    } catch (error) {
      toast({
        title: 'Activation preview failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const requestOrApplyActivation = async () => {
    if (!activationPreview) return;
    try {
      const result = await applyActivation.mutateAsync({
        draftId: activationPreview.draftId,
        revision: activationPreview.draftRevision,
        requestId: activationPreview.requestId,
        expectedRequestRevision: activationPreview.requestRevision,
        approvalId: activationApprovalId,
      });
      if (result.version) {
        setActivationApprovalId(undefined);
        toast({ title: `Automation ${result.version.id} activated` });
      } else {
        setActivationApprovalId(result.approvalId);
        toast({
          title: 'Exact approval required',
          description: `${result.approvalId} is available in Run Approvals.`,
        });
      }
    } catch (error) {
      toast({
        title: activationApprovalId ? 'Activation failed' : 'Approval request failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (scheduler.isLoading) {
    return (
      <Group gap="sm" className="text-muted-foreground">
        <Loader size="xs" />
        <Text size="sm">Loading scheduler...</Text>
      </Group>
    );
  }

  return (
    <SettingsPage
      title="Scheduler"
      description="Draft, activate, and monitor recurring work schedules."
      actions={
        <Group gap="xs" wrap="wrap">
          <Tooltip label="Run due schedules">
            <UiAction
              variant="secondary"
              disabled={!canExecute || runDue.isPending}
              leftSection={<Play className="h-3.5 w-3.5" />}
              onClick={() => mutate(() => runDue.mutateAsync(), 'Due schedules checked')}
            >
              Run Due
            </UiAction>
          </Tooltip>
          <Tooltip label="Refresh scheduler">
            <UiAction
              variant="quiet"
              leftSection={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => scheduler.refetch()}
            >
              Refresh
            </UiAction>
          </Tooltip>
        </Group>
      }
    >
      <SettingsSection
        title="Recurring Work Scheduler"
        description="Compile reviewable drafts, manage schedules, and inspect recent runs."
      >
        <Stack gap="lg">
          <SettingsGroup>
            <Stack gap="sm">
              <Stack gap={2}>
                <Text size="sm" fw={600}>
                  Automation Draft
                </Text>
                <Text size="xs" c="dimmed">
                  Compile recurring intent into an inactive, reviewable draft. Previewing and saving
                  never activates a schedule.
                </Text>
              </Stack>
              <Textarea
                label="Recurring objective"
                placeholder="Every weekday at 9 AM, review the support queue and produce a triage report."
                value={intent}
                onChange={(event) => setIntent(event.currentTarget.value)}
                minRows={2}
              />
              <Textarea
                label="Structured hints (JSON)"
                description="Consequential values are never silently defaulted. Include timezone, workflow or task template, provider, expiry, scope, budgets, outputs, retries, and stop conditions."
                value={hintsJson}
                onChange={(event) => setHintsJson(event.currentTarget.value)}
                minRows={4}
                className="font-mono"
              />
              <Group gap="xs">
                <UiAction
                  variant="secondary"
                  disabled={!intent.trim() || previewDraft.isPending || saveDraft.isPending}
                  onClick={() => void compileDraft(false)}
                >
                  Preview
                </UiAction>
                <UiAction
                  variant="primary"
                  disabled={
                    !canWrite || !intent.trim() || previewDraft.isPending || saveDraft.isPending
                  }
                  onClick={() => void compileDraft(true)}
                >
                  Save Inactive Draft
                </UiAction>
              </Group>
              {draftPreview && <AutomationDraftReview draft={draftPreview} />}
            </Stack>
          </SettingsGroup>

          {(drafts.data?.drafts.length ?? 0) > 0 && (
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Saved Inactive Drafts
              </Text>
              {drafts.data?.drafts.map((draft) => (
                <AutomationDraftReview
                  key={draft.id}
                  draft={draft}
                  compact
                  onReviewActivation={canWrite ? () => void reviewActivation(draft) : undefined}
                />
              ))}
            </Stack>
          )}

          {activationPreview && (
            <SettingsNotice
              tone={activationPreview.evidence.enforceable ? 'neutral' : 'error'}
              title={`Activation review · ${activationPreview.draftId}`}
            >
              <Stack gap="xs">
                <Text size="xs">
                  {activationPreview.evidence.workflowId}@
                  {activationPreview.evidence.workflowVersion} ·{' '}
                  {activationPreview.evidence.provider} · expires{' '}
                  {formatDate(activationPreview.schedule.expiresAt)}
                </Text>
                <Text size="xs">
                  Run Access ceiling: {activationPreview.effectiveRunAccess.tools.length} tools,{' '}
                  {activationPreview.effectiveRunAccess.integrations.length} integrations,{' '}
                  {activationPreview.effectiveRunAccess.externalTargets.length} external targets
                </Text>
                <Text size="xs" className="font-mono">
                  {activationPreview.requestRevision}
                </Text>
                {activationPreview.evidence.blockers.map((blocker) => (
                  <Text key={blocker} size="xs" c="red">
                    {blocker}
                  </Text>
                ))}
                <Group gap="xs">
                  <UiAction
                    variant="primary"
                    disabled={!activationPreview.evidence.enforceable || applyActivation.isPending}
                    onClick={() => void requestOrApplyActivation()}
                  >
                    {activationApprovalId ? 'Activate Approved Version' : 'Request Exact Approval'}
                  </UiAction>
                  {activationApprovalId && (
                    <Text size="xs" c="dimmed">
                      Approve {activationApprovalId} in Run Approvals, then activate this exact
                      version.
                    </Text>
                  )}
                </Group>
              </Stack>
            </SettingsNotice>
          )}

          {scheduler.data && (
            <SimpleGrid cols={{ base: 2, md: 5 }} spacing="sm">
              <SummaryStat label="Total" value={scheduler.data.summary.total} />
              <SummaryStat label="Enabled" value={scheduler.data.summary.enabled} />
              <SummaryStat label="Due" value={scheduler.data.summary.due} />
              <SummaryStat label="Failed" value={scheduler.data.summary.failed} />
              <SummaryStat label="Blocked" value={scheduler.data.summary.blocked} />
            </SimpleGrid>
          )}

          <Stack gap="sm">
            {items.length === 0 ? (
              <SettingsGroup empty className="text-center">
                <Text size="sm" c="dimmed">
                  No recurring work is configured.
                </Text>
              </SettingsGroup>
            ) : (
              items.map((item) => (
                <SettingsGroup key={item.id}>
                  <Stack gap="sm">
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={2}>
                        <Group gap="xs">
                          <Text size="sm" fw={600}>
                            {item.name}
                          </Text>
                          <UiPill>
                            {item.kind === 'workflow'
                              ? 'Workflow'
                              : item.kind === 'queue-monitor'
                                ? 'Queue'
                                : item.kind === 'automation'
                                  ? 'Automation'
                                  : 'Deliverable'}
                          </UiPill>
                          <HealthBadge item={item} />
                        </Group>
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {item.description}
                        </Text>
                      </Stack>
                      <Group gap="xs">
                        <UiAction
                          variant="quiet"
                          disabled={validate.isPending}
                          leftSection={<CheckCircle2 className="h-3.5 w-3.5" />}
                          onClick={() =>
                            mutate(() => validate.mutateAsync(item.id), 'Scheduler item validated')
                          }
                        >
                          Validate
                        </UiAction>
                        <UiAction
                          variant="secondary"
                          disabled={!canExecute || runItem.isPending || !item.actions.canRun}
                          leftSection={<Play className="h-3.5 w-3.5" />}
                          onClick={() =>
                            mutate(() => runItem.mutateAsync(item.id), 'Scheduler item run started')
                          }
                        >
                          Run
                        </UiAction>
                        {item.enabled ? (
                          <UiAction
                            variant="quiet"
                            disabled={!canWrite || pause.isPending || !item.actions.canPause}
                            leftSection={<Pause className="h-3.5 w-3.5" />}
                            onClick={() =>
                              mutate(() => pause.mutateAsync(item.id), 'Scheduler item paused')
                            }
                          >
                            Pause
                          </UiAction>
                        ) : (
                          <UiAction
                            variant="quiet"
                            disabled={!canWrite || resume.isPending || !item.actions.canResume}
                            leftSection={<RotateCw className="h-3.5 w-3.5" />}
                            onClick={() =>
                              mutate(() => resume.mutateAsync(item.id), 'Scheduler item resumed')
                            }
                          >
                            Resume
                          </UiAction>
                        )}
                      </Group>
                    </Group>
                    <SimpleGrid cols={{ base: 1, md: 4 }} spacing="xs">
                      <Meta label="Schedule" value={item.trigger.description} />
                      <Meta label="Next" value={formatDate(item.nextRunAt)} />
                      <Meta label="Last" value={formatDate(item.lastRunAt)} />
                      <Meta
                        label="Retry"
                        value={`${item.retry.attempts}/${item.retry.maxAttempts}`}
                      />
                    </SimpleGrid>
                    {item.lastSummary && (
                      <Text size="xs" c={item.lastStatus === 'failed' ? 'red' : 'dimmed'}>
                        {item.lastSummary}
                      </Text>
                    )}
                  </Stack>
                </SettingsGroup>
              ))
            )}
          </Stack>

          {events.length > 0 && (
            <Stack gap="sm">
              <Text size="sm" fw={600}>
                Recent Events
              </Text>
              <Stack gap="xs">
                {events.slice(0, 6).map((event) => (
                  <Group
                    key={event.id}
                    justify="space-between"
                    className="rounded border px-3 py-2"
                  >
                    <Stack gap={0}>
                      <Text size="xs" fw={600}>
                        {event.summary}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {event.itemId} · {formatDate(event.runAt)}
                      </Text>
                    </Stack>
                    <StatusBadge status={event.status} />
                  </Group>
                ))}
              </Stack>
            </Stack>
          )}
        </Stack>
      </SettingsSection>
    </SettingsPage>
  );
}

function AutomationDraftReview({
  draft,
  compact = false,
  onReviewActivation,
}: {
  draft: AutomationDraft;
  compact?: boolean;
  onReviewActivation?: () => void;
}) {
  const blockers = draft.validation.issues.filter((issue) => issue.severity === 'blocker');
  return (
    <SettingsNotice
      tone={blockers.length === 0 ? 'success' : 'warning'}
      title={`${draft.id} · revision ${draft.revision}`}
    >
      <Stack gap="xs">
        <Text size="xs">
          {draft.schedule.expression.value ?? 'Schedule unresolved'} ·{' '}
          {draft.schedule.timezone.value ?? 'Timezone unresolved'} · inactive
        </Text>
        {!compact && draft.schedule.nextRunExamples.length > 0 && (
          <Text size="xs" c="dimmed">
            Next examples: {draft.schedule.nextRunExamples.map(formatDate).join(' · ')}
          </Text>
        )}
        {blockers.length === 0 ? (
          <Group justify="space-between" align="center">
            <Text size="xs">
              No deterministic validation blockers. Activation still requires a separate review.
            </Text>
            {onReviewActivation && (
              <UiAction variant="secondary" onClick={onReviewActivation}>
                Review Activation
              </UiAction>
            )}
          </Group>
        ) : (
          <Stack gap={2}>
            {blockers.slice(0, compact ? 3 : undefined).map((issue) => (
              <Text key={`${issue.code}:${issue.path}`} size="xs">
                {issue.path}: {issue.message}
              </Text>
            ))}
          </Stack>
        )}
      </Stack>
    </SettingsNotice>
  );
}

function parseDraftHints(value: string): AutomationDraftHints {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Structured hints must be a JSON object.');
  }
  return parsed as AutomationDraftHints;
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <SettingsGroup>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="lg" fw={700}>
        {value}
      </Text>
    </SettingsGroup>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xs" fw={600}>
        {value}
      </Text>
    </Stack>
  );
}

function HealthBadge({ item }: { item: SchedulerItem }) {
  const color =
    item.health === 'healthy'
      ? 'green'
      : item.health === 'warning'
        ? 'yellow'
        : item.health === 'paused'
          ? 'gray'
          : 'red';
  return (
    <Tooltip label={item.healthSummary}>
      <UiPill kind="status" tone={semanticToneForLegacyColor(color)}>
        {item.health}
      </UiPill>
    </Tooltip>
  );
}

function StatusBadge({ status }: { status: SchedulerRunStatus }) {
  const color =
    status === 'success'
      ? 'green'
      : status === 'started'
        ? 'blue'
        : status === 'skipped'
          ? 'gray'
          : 'red';
  return (
    <UiPill kind="status" tone={semanticToneForLegacyColor(color)}>
      {status}
    </UiPill>
  );
}

function formatDate(value?: string): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Invalid';
  return date.toLocaleString();
}
