import path from 'node:path';
import { nanoid } from 'nanoid';
import type {
  CreateDecisionReviewSessionInput,
  DecisionReviewFinalPacket,
  DecisionReviewListFilters,
  DecisionReviewParticipant,
  DecisionReviewSession,
  DecisionReviewTurn,
  FinalizeDecisionReviewSessionInput,
  RecordDecisionReviewCritiqueInput,
  RecordDecisionReviewTurnInput,
  WorkProductRender,
} from '@veritas-kanban/shared';
import { BadRequestError, NotFoundError } from '../middleware/error-handler.js';
import { fileExists, mkdir, readFile, writeFile } from '../storage/fs-helpers.js';
import { getDataDir } from '../utils/paths.js';
import { DecisionService, getDecisionService } from './decision-service.js';
import { WorkProductService, getWorkProductService } from './work-product-service.js';

interface DecisionReviewFileState {
  sessions: DecisionReviewSession[];
}

export interface DecisionReviewServiceOptions {
  filePath?: string;
  decisionService?: DecisionService;
  workProductService?: WorkProductService;
}

export class DecisionReviewService {
  private readonly filePath: string;
  private loaded = false;
  private state: DecisionReviewFileState = { sessions: [] };

  constructor(private readonly options: DecisionReviewServiceOptions = {}) {
    this.filePath =
      options.filePath ?? path.join(getDataDir(), 'storage', 'decision-review-sessions.json');
  }

  async create(input: CreateDecisionReviewSessionInput): Promise<DecisionReviewSession> {
    const now = new Date().toISOString();
    const participants = this.normalizeParticipants(input.participants);
    const session: DecisionReviewSession = {
      id: `decision_review_${Date.now()}_${nanoid(6)}`,
      taskId: input.taskId,
      title: input.title,
      prompt: input.prompt,
      context: input.context,
      sourceType: input.sourceType ?? 'task',
      sourceId: input.sourceId,
      templateId: input.templateId,
      contextLimit: input.contextLimit,
      rounds: input.rounds ?? 1,
      participants,
      status: 'collecting',
      initialResponses: [],
      critiqueRounds: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.ensureLoaded();
    this.state.sessions.push(session);
    await this.saveState();
    return session;
  }

  async list(filters: DecisionReviewListFilters = {}): Promise<DecisionReviewSession[]> {
    await this.ensureLoaded();
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);
    return this.state.sessions
      .filter((session) => {
        if (filters.taskId && session.taskId !== filters.taskId) return false;
        if (filters.status && session.status !== filters.status) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  async get(id: string): Promise<DecisionReviewSession | null> {
    await this.ensureLoaded();
    return this.state.sessions.find((session) => session.id === id) ?? null;
  }

  async recordInitialResponse(
    sessionId: string,
    input: RecordDecisionReviewTurnInput
  ): Promise<DecisionReviewSession> {
    const session = await this.requireMutableSession(sessionId);
    if (session.initialResponses.some((turn) => turn.participantId === input.participantId)) {
      throw new BadRequestError(`Initial response already recorded for ${input.participantId}`);
    }

    const participant = this.requireParticipant(session, input.participantId);
    session.initialResponses.push(
      this.createTurn(session, participant, 'initial', 0, input, undefined)
    );
    session.status =
      session.initialResponses.length === session.participants.length ? 'critiquing' : 'collecting';
    session.updatedAt = new Date().toISOString();
    await this.saveState();
    return session;
  }

  async recordCritique(
    sessionId: string,
    input: RecordDecisionReviewCritiqueInput
  ): Promise<DecisionReviewSession> {
    const session = await this.requireMutableSession(sessionId);
    if (session.initialResponses.length < session.participants.length) {
      throw new BadRequestError('All initial responses must be recorded before critique rounds');
    }
    if (input.round > session.rounds) {
      throw new BadRequestError(`Round ${input.round} exceeds configured rounds ${session.rounds}`);
    }
    const participant = this.requireParticipant(session, input.participantId);
    const critiquesParticipantIds = input.critiquesParticipantIds?.length
      ? input.critiquesParticipantIds
      : session.participants
          .map((candidate) => candidate.id)
          .filter((participantId) => participantId !== input.participantId);
    for (const participantId of critiquesParticipantIds) {
      this.requireParticipant(session, participantId);
    }
    if (
      session.critiqueRounds.some(
        (turn) => turn.round === input.round && turn.participantId === input.participantId
      )
    ) {
      throw new BadRequestError(
        `Critique already recorded for ${input.participantId} in round ${input.round}`
      );
    }

    session.critiqueRounds.push(
      this.createTurn(session, participant, 'critique', input.round, input, critiquesParticipantIds)
    );
    session.status = 'critiquing';
    session.updatedAt = new Date().toISOString();
    await this.saveState();
    return session;
  }

  async finalize(
    sessionId: string,
    input: FinalizeDecisionReviewSessionInput
  ): Promise<DecisionReviewSession> {
    const session = await this.requireMutableSession(sessionId);
    this.assertReadyForFinalization(session);

    const now = new Date().toISOString();
    const finalPacket: DecisionReviewFinalPacket = {
      recommendation: input.recommendation,
      dissentingViews: input.dissentingViews ?? [],
      assumptions: input.assumptions ?? [],
      risks: input.risks ?? [],
      validationPlan: input.validationPlan ?? [],
      followUpTasks: input.followUpTasks ?? [],
      confidenceLevel: input.confidenceLevel ?? 70,
      riskScore: input.riskScore ?? 50,
      summary: input.summary,
      createdAt: now,
    };

    if (input.attachWorkProduct !== false) {
      const workProduct = await this.workProductService().create({
        kind: 'report',
        title: `Decision Review: ${session.title}`,
        render: this.buildFinalWorkProductRender(session, finalPacket),
        taskId: session.taskId,
        agent: 'decision-review',
        redaction: {
          level: 'standard',
          containsSensitiveContent: false,
          sensitiveFields: ['tokens', 'secrets', 'local paths'],
          exportDefault: 'redacted',
        },
        sourceLinks: [
          {
            label: 'Task',
            href: `veritas://task/${encodeURIComponent(session.taskId)}?tab=review`,
            type: 'task',
          },
        ],
        metadata: {
          packetType: 'decision_review',
          decisionReviewSessionId: session.id,
          sourceType: session.sourceType,
          sourceId: session.sourceId ?? null,
          participantCount: session.participants.length,
          critiqueRounds: session.rounds,
        },
        changeSummary: 'Generated decision review packet',
      });
      finalPacket.workProductId = workProduct.id;
    }

    const decision = await this.decisionService().create({
      inputContext: `${session.prompt}\n\n${session.context}`,
      outputAction: finalPacket.recommendation,
      assumptions: finalPacket.assumptions,
      confidenceLevel: finalPacket.confidenceLevel,
      riskScore: finalPacket.riskScore,
      agentId: 'decision-review',
      taskId: session.taskId,
      timestamp: now,
    });
    finalPacket.decisionId = decision.id;

    session.finalPacket = finalPacket;
    session.status = 'synthesized';
    session.updatedAt = now;
    await this.saveState();
    return session;
  }

  async cancel(sessionId: string): Promise<DecisionReviewSession> {
    const session = await this.requireMutableSession(sessionId);
    const now = new Date().toISOString();
    session.status = 'canceled';
    session.updatedAt = now;
    session.canceledAt = now;
    await this.saveState();
    return session;
  }

  exportMarkdown(session: DecisionReviewSession): string {
    const lines = [
      `# Decision Review: ${session.title}`,
      '',
      `Status: ${session.status}`,
      `Task: ${session.taskId}`,
      `Source: ${session.sourceType}${session.sourceId ? ` ${session.sourceId}` : ''}`,
      `Rounds: ${session.rounds}`,
      '',
      '## Prompt',
      '',
      session.prompt,
      '',
      '## Context',
      '',
      session.context,
      '',
      '## Participants',
      '',
      this.markdownList(
        session.participants.map((participant) => this.participantLine(participant))
      ),
      '',
      '## Initial Responses',
      '',
      ...session.initialResponses.flatMap((turn) => this.turnSection(session, turn)),
      '## Critique Rounds',
      '',
      ...session.critiqueRounds.flatMap((turn) => this.turnSection(session, turn)),
    ];

    if (session.finalPacket) {
      lines.push(...this.finalPacketSections(session.finalPacket));
    }

    return `${lines.join('\n')}\n`;
  }

  private async requireMutableSession(sessionId: string): Promise<DecisionReviewSession> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new NotFoundError('Decision review session not found');
    }
    if (session.status === 'synthesized' || session.status === 'canceled') {
      throw new BadRequestError(`Decision review session is ${session.status}`);
    }
    return session;
  }

  private requireParticipant(
    session: DecisionReviewSession,
    participantId: string
  ): DecisionReviewParticipant {
    const participant = session.participants.find((candidate) => candidate.id === participantId);
    if (!participant) {
      throw new BadRequestError(`Unknown participant: ${participantId}`);
    }
    return participant;
  }

  private createTurn(
    session: DecisionReviewSession,
    participant: DecisionReviewParticipant,
    phase: DecisionReviewTurn['phase'],
    round: number,
    input: RecordDecisionReviewTurnInput,
    critiquesParticipantIds: string[] | undefined
  ): DecisionReviewTurn {
    return {
      id: `${phase}_${Date.now()}_${nanoid(6)}`,
      participantId: participant.id,
      phase,
      round,
      prompt: input.prompt ?? this.defaultTurnPrompt(session, phase, round),
      response: input.response,
      critiquesParticipantIds,
      agentId: input.agentId ?? participant.agentId,
      profileId: input.profileId ?? participant.profileId,
      provider: input.provider ?? participant.provider,
      model: input.model ?? participant.model,
      createdAt: new Date().toISOString(),
    };
  }

  private assertReadyForFinalization(session: DecisionReviewSession): void {
    if (session.initialResponses.length < session.participants.length) {
      throw new BadRequestError('All initial responses must be recorded before final synthesis');
    }

    for (let round = 1; round <= session.rounds; round += 1) {
      const roundParticipants = new Set(
        session.critiqueRounds
          .filter((turn) => turn.round === round)
          .map((turn) => turn.participantId)
      );
      for (const participant of session.participants) {
        if (!roundParticipants.has(participant.id)) {
          throw new BadRequestError(
            `Critique round ${round} is missing participant ${participant.id}`
          );
        }
      }
    }
  }

  private buildFinalWorkProductRender(
    session: DecisionReviewSession,
    packet: DecisionReviewFinalPacket
  ): WorkProductRender {
    return {
      schemaVersion: 1,
      kind: 'report',
      summary: packet.summary ?? packet.recommendation,
      sections: [
        { heading: 'Recommendation', body: packet.recommendation },
        { heading: 'Dissenting Views', body: this.optionalList(packet.dissentingViews) },
        { heading: 'Assumptions', body: this.optionalList(packet.assumptions) },
        { heading: 'Risks', body: this.optionalList(packet.risks) },
        { heading: 'Validation Plan', body: this.optionalList(packet.validationPlan) },
        { heading: 'Follow-up Tasks', body: this.optionalList(packet.followUpTasks) },
        {
          heading: 'Participants',
          body: this.markdownList(
            session.participants.map((participant) => this.participantLine(participant))
          ),
        },
        {
          heading: 'Initial Responses',
          body: session.initialResponses
            .map((turn) => this.turnMarkdown(session, turn))
            .join('\n\n'),
        },
        {
          heading: 'Critique Rounds',
          body: session.critiqueRounds.map((turn) => this.turnMarkdown(session, turn)).join('\n\n'),
        },
      ],
    };
  }

  private normalizeParticipants(
    participants: DecisionReviewParticipant[]
  ): DecisionReviewParticipant[] {
    const seen = new Set<string>();
    return participants.map((participant) => {
      if (seen.has(participant.id)) {
        throw new BadRequestError(`Duplicate participant id: ${participant.id}`);
      }
      seen.add(participant.id);
      return participant;
    });
  }

  private defaultTurnPrompt(
    session: DecisionReviewSession,
    phase: DecisionReviewTurn['phase'],
    round: number
  ): string {
    if (phase === 'initial') {
      return `Give an independent recommendation for: ${session.prompt}`;
    }
    return `Critique round ${round}: challenge weak assumptions, missing risks, and tradeoffs.`;
  }

  private participantLine(participant: DecisionReviewParticipant): string {
    const metadata = [
      participant.agentId ? `agent ${participant.agentId}` : null,
      participant.profileId ? `profile ${participant.profileId}` : null,
      participant.provider ? `provider ${participant.provider}` : null,
      participant.model ? `model ${participant.model}` : null,
      participant.role ? `role ${participant.role}` : null,
    ].filter((value): value is string => Boolean(value));
    return `${participant.label}${metadata.length > 0 ? ` (${metadata.join(', ')})` : ''}`;
  }

  private turnSection(session: DecisionReviewSession, turn: DecisionReviewTurn): string[] {
    return [this.turnMarkdown(session, turn), ''];
  }

  private turnMarkdown(session: DecisionReviewSession, turn: DecisionReviewTurn): string {
    const participant =
      session.participants.find((candidate) => candidate.id === turn.participantId)?.label ??
      turn.participantId;
    const target =
      turn.critiquesParticipantIds && turn.critiquesParticipantIds.length > 0
        ? ` Critiques: ${turn.critiquesParticipantIds.join(', ')}.`
        : '';
    return [
      `### ${participant} ${turn.phase}${turn.round > 0 ? ` round ${turn.round}` : ''}`,
      '',
      `Prompt: ${turn.prompt}${target}`,
      '',
      turn.response,
    ].join('\n');
  }

  private finalPacketSections(packet: DecisionReviewFinalPacket): string[] {
    return [
      '## Final Packet',
      '',
      `Confidence: ${packet.confidenceLevel}`,
      `Risk: ${packet.riskScore}`,
      packet.workProductId ? `Work product: ${packet.workProductId}` : null,
      packet.decisionId ? `Decision: ${packet.decisionId}` : null,
      '',
      '### Recommendation',
      '',
      packet.recommendation,
      '',
      '### Dissenting Views',
      '',
      this.optionalList(packet.dissentingViews),
      '',
      '### Assumptions',
      '',
      this.optionalList(packet.assumptions),
      '',
      '### Risks',
      '',
      this.optionalList(packet.risks),
      '',
      '### Validation Plan',
      '',
      this.optionalList(packet.validationPlan),
      '',
      '### Follow-up Tasks',
      '',
      this.optionalList(packet.followUpTasks),
    ].filter((line): line is string => line !== null);
  }

  private optionalList(items: string[]): string {
    return items.length > 0 ? this.markdownList(items) : 'None recorded.';
  }

  private markdownList(items: string[]): string {
    return items.map((item) => `- ${item}`).join('\n');
  }

  private decisionService(): DecisionService {
    return this.options.decisionService ?? getDecisionService();
  }

  private workProductService(): WorkProductService {
    return this.options.workProductService ?? getWorkProductService();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!(await fileExists(this.filePath))) {
      this.state = { sessions: [] };
      this.loaded = true;
      return;
    }
    const raw = await readFile(this.filePath, 'utf8');
    this.state = JSON.parse(raw) as DecisionReviewFileState;
    this.loaded = true;
  }

  private async saveState(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }
}

let instance: DecisionReviewService | null = null;

export function getDecisionReviewService(): DecisionReviewService {
  if (!instance) {
    instance = new DecisionReviewService();
  }
  return instance;
}
