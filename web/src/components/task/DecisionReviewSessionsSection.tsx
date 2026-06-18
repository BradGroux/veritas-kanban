import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { BrainCircuit, CheckCircle, FileText, MessageSquare, XCircle } from 'lucide-react';
import type { DecisionReviewSession, Task } from '@veritas-kanban/shared';
import { useAgentProfiles } from '@/hooks/useConfig';
import {
  useCancelDecisionReview,
  useCreateDecisionReview,
  useDecisionReviews,
  useExportDecisionReview,
  useFinalizeDecisionReview,
  useRecordDecisionReviewCritique,
  useRecordDecisionReviewResponse,
} from '@/hooks/useDecisionReviews';

interface DecisionReviewSessionsSectionProps {
  task: Task;
}

function normalizeParticipantId(value: string, fallback: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}

function linesToList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function sessionComplete(session: DecisionReviewSession): boolean {
  if (session.initialResponses.length < session.participants.length) return false;
  for (let round = 1; round <= session.rounds; round += 1) {
    const participants = new Set(
      session.critiqueRounds
        .filter((turn) => turn.round === round)
        .map((turn) => turn.participantId)
    );
    if (session.participants.some((participant) => !participants.has(participant.id))) {
      return false;
    }
  }
  return true;
}

function statusColor(status: DecisionReviewSession['status']): string {
  if (status === 'synthesized') return 'green';
  if (status === 'canceled') return 'gray';
  if (status === 'critiquing') return 'yellow';
  return 'blue';
}

export function DecisionReviewSessionsSection({ task }: DecisionReviewSessionsSectionProps) {
  const { data: sessions = [], isLoading } = useDecisionReviews({ taskId: task.id, limit: 20 });
  const { data: profiles = [] } = useAgentProfiles();
  const createSession = useCreateDecisionReview();
  const recordResponse = useRecordDecisionReviewResponse();
  const recordCritique = useRecordDecisionReviewCritique();
  const finalizeSession = useFinalizeDecisionReview();
  const cancelSession = useCancelDecisionReview();
  const exportSession = useExportDecisionReview();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState(`Decision Review: ${task.title}`);
  const [prompt, setPrompt] = useState(task.description || task.title);
  const [context, setContext] = useState(task.description || task.title);
  const [rounds, setRounds] = useState(1);
  const [participantsText, setParticipantsText] = useState('');
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});
  const [critiqueDrafts, setCritiqueDrafts] = useState<Record<string, string>>({});
  const [exportedMarkdown, setExportedMarkdown] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [dissentingViews, setDissentingViews] = useState('');
  const [assumptions, setAssumptions] = useState('');
  const [risks, setRisks] = useState('');
  const [validationPlan, setValidationPlan] = useState('');
  const [followUpTasks, setFollowUpTasks] = useState('');
  const [confidenceLevel, setConfidenceLevel] = useState(70);
  const [riskScore, setRiskScore] = useState(50);

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  );

  useEffect(() => {
    if (participantsText.trim()) return;
    const enabledProfiles = profiles.filter((profile) => profile.enabled).slice(0, 2);
    if (enabledProfiles.length >= 2) {
      setParticipantsText(
        enabledProfiles.map((profile) => `${profile.id}|${profile.displayName}`).join('\n')
      );
    } else {
      setParticipantsText('architect|Architect\nreviewer|Reviewer');
    }
  }, [participantsText, profiles]);

  useEffect(() => {
    if (!selectedId && sessions.length > 0) {
      setSelectedId(sessions[0].id);
    }
  }, [selectedId, sessions]);

  const selectedSession = sessions.find((session) => session.id === selectedId) ?? sessions[0];

  const parsedParticipants = useMemo(
    () =>
      linesToList(participantsText).map((line, index) => {
        const [rawId, rawLabel] = line.split('|').map((part) => part.trim());
        const id = normalizeParticipantId(rawId, `participant-${index + 1}`);
        const profile = profileById.get(id);
        return {
          id,
          label: rawLabel || profile?.displayName || id,
          profileId: profile?.id,
          agentId: profile?.runtime.agent,
          provider: profile?.runtime.provider,
          model: profile?.runtime.model,
          role: profile?.role,
        };
      }),
    [participantsText, profileById]
  );

  const createDisabled =
    parsedParticipants.length < 2 || !title.trim() || !prompt.trim() || !context.trim();

  const handleCreate = async () => {
    const session = await createSession.mutateAsync({
      taskId: task.id,
      title: title.trim(),
      prompt: prompt.trim(),
      context: context.trim(),
      sourceType: 'task',
      sourceId: task.id,
      rounds,
      participants: parsedParticipants,
    });
    setSelectedId(session.id);
    setExportedMarkdown('');
  };

  const updateResponseDraft = (participantId: string, value: string) => {
    setResponseDrafts((current) => ({ ...current, [participantId]: value }));
  };

  const updateCritiqueDraft = (key: string, value: string) => {
    setCritiqueDrafts((current) => ({ ...current, [key]: value }));
  };

  const handleFinalize = async (session: DecisionReviewSession) => {
    const updated = await finalizeSession.mutateAsync({
      id: session.id,
      input: {
        recommendation,
        dissentingViews: linesToList(dissentingViews),
        assumptions: linesToList(assumptions),
        risks: linesToList(risks),
        validationPlan: linesToList(validationPlan),
        followUpTasks: linesToList(followUpTasks),
        confidenceLevel,
        riskScore,
        attachWorkProduct: true,
      },
    });
    setSelectedId(updated.id);
  };

  return (
    <Paper className="p-3" radius="md" withBorder>
      <Stack gap="md">
        <Group justify="space-between" gap="xs">
          <Group gap="xs">
            <BrainCircuit className="h-4 w-4" />
            <Text fw={600}>Decision Review Sessions</Text>
          </Group>
          <Badge variant="light" tt="none">
            {sessions.length}
          </Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          <TextInput
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <NumberInput
            label="Critique rounds"
            min={1}
            max={5}
            value={rounds}
            onChange={(value) => setRounds(typeof value === 'number' ? value : 1)}
          />
        </SimpleGrid>
        <Textarea
          label="Decision prompt"
          minRows={2}
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
        />
        <Textarea
          label="Context packet"
          minRows={3}
          value={context}
          onChange={(event) => setContext(event.currentTarget.value)}
        />
        <Textarea
          label="Participants"
          minRows={2}
          value={participantsText}
          onChange={(event) => setParticipantsText(event.currentTarget.value)}
        />
        <Button
          onClick={handleCreate}
          disabled={createDisabled || createSession.isPending}
          leftSection={<MessageSquare className="h-4 w-4" />}
        >
          Start Decision Review
        </Button>

        {isLoading ? (
          <Text size="sm" c="dimmed">
            Loading decision reviews...
          </Text>
        ) : sessions.length > 0 ? (
          <Select
            label="Session"
            value={selectedSession?.id ?? null}
            onChange={setSelectedId}
            data={sessions.map((session) => ({
              value: session.id,
              label: `${session.title} (${session.status})`,
            }))}
            allowDeselect={false}
          />
        ) : null}

        {selectedSession && (
          <DecisionReviewSessionDetail
            session={selectedSession}
            responseDrafts={responseDrafts}
            critiqueDrafts={critiqueDrafts}
            exportedMarkdown={exportedMarkdown}
            recommendation={recommendation}
            dissentingViews={dissentingViews}
            assumptions={assumptions}
            risks={risks}
            validationPlan={validationPlan}
            followUpTasks={followUpTasks}
            confidenceLevel={confidenceLevel}
            riskScore={riskScore}
            onResponseDraft={updateResponseDraft}
            onCritiqueDraft={updateCritiqueDraft}
            onRecommendation={setRecommendation}
            onDissentingViews={setDissentingViews}
            onAssumptions={setAssumptions}
            onRisks={setRisks}
            onValidationPlan={setValidationPlan}
            onFollowUpTasks={setFollowUpTasks}
            onConfidenceLevel={setConfidenceLevel}
            onRiskScore={setRiskScore}
            onRecordResponse={(participantId, response) =>
              recordResponse.mutateAsync({
                id: selectedSession.id,
                input: { participantId, response },
              })
            }
            onRecordCritique={(participantId, round, response) =>
              recordCritique.mutateAsync({
                id: selectedSession.id,
                input: { participantId, round, response },
              })
            }
            onFinalize={() => handleFinalize(selectedSession)}
            onCancel={() => cancelSession.mutate(selectedSession.id)}
            onExport={async () => {
              const markdown = await exportSession.mutateAsync(selectedSession.id);
              setExportedMarkdown(markdown);
            }}
            busy={
              recordResponse.isPending ||
              recordCritique.isPending ||
              finalizeSession.isPending ||
              cancelSession.isPending ||
              exportSession.isPending
            }
          />
        )}
      </Stack>
    </Paper>
  );
}

interface DetailProps {
  session: DecisionReviewSession;
  responseDrafts: Record<string, string>;
  critiqueDrafts: Record<string, string>;
  exportedMarkdown: string;
  recommendation: string;
  dissentingViews: string;
  assumptions: string;
  risks: string;
  validationPlan: string;
  followUpTasks: string;
  confidenceLevel: number;
  riskScore: number;
  onResponseDraft: (participantId: string, value: string) => void;
  onCritiqueDraft: (key: string, value: string) => void;
  onRecommendation: (value: string) => void;
  onDissentingViews: (value: string) => void;
  onAssumptions: (value: string) => void;
  onRisks: (value: string) => void;
  onValidationPlan: (value: string) => void;
  onFollowUpTasks: (value: string) => void;
  onConfidenceLevel: (value: number) => void;
  onRiskScore: (value: number) => void;
  onRecordResponse: (participantId: string, response: string) => Promise<unknown>;
  onRecordCritique: (participantId: string, round: number, response: string) => Promise<unknown>;
  onFinalize: () => Promise<void>;
  onCancel: () => void;
  onExport: () => Promise<void>;
  busy: boolean;
}

function DecisionReviewSessionDetail({
  session,
  responseDrafts,
  critiqueDrafts,
  exportedMarkdown,
  recommendation,
  dissentingViews,
  assumptions,
  risks,
  validationPlan,
  followUpTasks,
  confidenceLevel,
  riskScore,
  onResponseDraft,
  onCritiqueDraft,
  onRecommendation,
  onDissentingViews,
  onAssumptions,
  onRisks,
  onValidationPlan,
  onFollowUpTasks,
  onConfidenceLevel,
  onRiskScore,
  onRecordResponse,
  onRecordCritique,
  onFinalize,
  onCancel,
  onExport,
  busy,
}: DetailProps) {
  const initialComplete = session.initialResponses.length >= session.participants.length;
  const readyForFinal = sessionComplete(session);

  return (
    <Stack gap="md">
      <Group justify="space-between" gap="xs">
        <Stack gap={2}>
          <Text fw={600}>{session.title}</Text>
          <Text size="xs" c="dimmed">
            {session.participants.length} participants · {session.rounds} round
            {session.rounds === 1 ? '' : 's'}
          </Text>
        </Stack>
        <Badge color={statusColor(session.status)} variant="light" tt="none">
          {session.status}
        </Badge>
      </Group>

      <Stack gap="xs">
        <Text size="sm" fw={500}>
          Initial Responses
        </Text>
        {session.participants.map((participant) => {
          const turn = session.initialResponses.find(
            (candidate) => candidate.participantId === participant.id
          );
          const draft = responseDrafts[participant.id] ?? '';
          return (
            <Paper key={participant.id} className="p-3" radius="md" withBorder>
              <Stack gap="xs">
                <Group justify="space-between" gap="xs">
                  <Text size="sm" fw={500}>
                    {participant.label}
                  </Text>
                  {turn ? (
                    <Badge
                      color="green"
                      variant="light"
                      leftSection={<CheckCircle className="h-3 w-3" />}
                    >
                      Recorded
                    </Badge>
                  ) : (
                    <Badge color="blue" variant="light">
                      Pending
                    </Badge>
                  )}
                </Group>
                {turn ? (
                  <Text size="sm" className="whitespace-pre-wrap">
                    {turn.response}
                  </Text>
                ) : (
                  <>
                    <Textarea
                      label={`${participant.label} response`}
                      minRows={3}
                      value={draft}
                      onChange={(event) =>
                        onResponseDraft(participant.id, event.currentTarget.value)
                      }
                    />
                    <Button
                      size="xs"
                      disabled={!draft.trim() || busy}
                      onClick={() => onRecordResponse(participant.id, draft.trim())}
                    >
                      Save Response
                    </Button>
                  </>
                )}
              </Stack>
            </Paper>
          );
        })}
      </Stack>

      {initialComplete && session.status !== 'synthesized' && (
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Critique Rounds
          </Text>
          {Array.from({ length: session.rounds }, (_, index) => index + 1).map((round) => (
            <Paper key={round} className="p-3" radius="md" withBorder>
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  Round {round}
                </Text>
                {session.participants.map((participant) => {
                  const key = `${round}:${participant.id}`;
                  const turn = session.critiqueRounds.find(
                    (candidate) =>
                      candidate.round === round && candidate.participantId === participant.id
                  );
                  const draft = critiqueDrafts[key] ?? '';
                  return (
                    <Stack key={key} gap="xs">
                      <Group justify="space-between" gap="xs">
                        <Text size="sm">{participant.label}</Text>
                        {turn && (
                          <Badge color="green" variant="light">
                            Recorded
                          </Badge>
                        )}
                      </Group>
                      {turn ? (
                        <Text size="sm" className="whitespace-pre-wrap">
                          {turn.response}
                        </Text>
                      ) : (
                        <>
                          <Textarea
                            label={`${participant.label} critique round ${round}`}
                            minRows={2}
                            value={draft}
                            onChange={(event) => onCritiqueDraft(key, event.currentTarget.value)}
                          />
                          <Button
                            size="xs"
                            disabled={!draft.trim() || busy}
                            onClick={() => onRecordCritique(participant.id, round, draft.trim())}
                          >
                            Save Critique
                          </Button>
                        </>
                      )}
                    </Stack>
                  );
                })}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {session.status === 'synthesized' && session.finalPacket ? (
        <Paper className="bg-muted/40 p-3" radius="md" withBorder>
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Final Packet
            </Text>
            <Text size="sm" className="whitespace-pre-wrap">
              {session.finalPacket.recommendation}
            </Text>
            <Group gap="xs">
              {session.finalPacket.workProductId && (
                <Badge variant="light" leftSection={<FileText className="h-3 w-3" />}>
                  {session.finalPacket.workProductId}
                </Badge>
              )}
              {session.finalPacket.decisionId && (
                <Badge variant="light">{session.finalPacket.decisionId}</Badge>
              )}
            </Group>
            <Button size="xs" variant="outline" onClick={onExport} disabled={busy}>
              Export Packet
            </Button>
            {exportedMarkdown && (
              <Textarea label="Exported markdown" minRows={5} value={exportedMarkdown} readOnly />
            )}
          </Stack>
        </Paper>
      ) : readyForFinal ? (
        <Paper className="p-3" radius="md" withBorder>
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Final Synthesis
            </Text>
            <Textarea
              label="Recommendation"
              minRows={3}
              value={recommendation}
              onChange={(event) => onRecommendation(event.currentTarget.value)}
            />
            <Textarea
              label="Dissenting views"
              minRows={2}
              value={dissentingViews}
              onChange={(event) => onDissentingViews(event.currentTarget.value)}
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <Textarea
                label="Assumptions"
                minRows={2}
                value={assumptions}
                onChange={(event) => onAssumptions(event.currentTarget.value)}
              />
              <Textarea
                label="Risks"
                minRows={2}
                value={risks}
                onChange={(event) => onRisks(event.currentTarget.value)}
              />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <Textarea
                label="Validation plan"
                minRows={2}
                value={validationPlan}
                onChange={(event) => onValidationPlan(event.currentTarget.value)}
              />
              <Textarea
                label="Follow-up tasks"
                minRows={2}
                value={followUpTasks}
                onChange={(event) => onFollowUpTasks(event.currentTarget.value)}
              />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <NumberInput
                label="Confidence"
                min={0}
                max={100}
                value={confidenceLevel}
                onChange={(value) => onConfidenceLevel(typeof value === 'number' ? value : 70)}
              />
              <NumberInput
                label="Risk"
                min={0}
                max={100}
                value={riskScore}
                onChange={(value) => onRiskScore(typeof value === 'number' ? value : 50)}
              />
            </SimpleGrid>
            <Button disabled={!recommendation.trim() || busy} onClick={onFinalize}>
              Finalize Packet
            </Button>
          </Stack>
        </Paper>
      ) : null}

      {session.status !== 'synthesized' && session.status !== 'canceled' && (
        <Button
          variant="subtle"
          color="red"
          size="xs"
          onClick={onCancel}
          disabled={busy}
          leftSection={<XCircle className="h-4 w-4" />}
        >
          Cancel Session
        </Button>
      )}
    </Stack>
  );
}
