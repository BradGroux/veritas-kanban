import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type {
  CreateRunSessionShareInput,
  ForkRunSessionInput,
  RunSessionActor,
  RunSessionApprovalResponseInput,
  RunSessionEvent,
  RunSessionFork,
  RunSessionPermission,
  RunSessionShare,
  RunSessionShareListFilters,
  RunSessionShareStatus,
  RunSessionSnapshot,
  SendRunSessionMessageInput,
  Task,
  UpdateRunSessionShareInput,
} from '@veritas-kanban/shared';
import { getDataDir } from '../utils/paths.js';
import { validatePathSegment } from '../utils/sanitize.js';
import { redactString } from '../lib/redact.js';
import { ForbiddenError, NotFoundError } from '../middleware/error-handler.js';
import { getTaskService, type TaskService } from './task-service.js';
import { clawdbotAgentService } from './clawdbot-agent-service.js';
import { broadcastRunSessionEvent } from './broadcast-service.js';

interface RunSessionShareState {
  shares: RunSessionShare[];
  events: RunSessionEvent[];
  forks: RunSessionFork[];
}

interface RunSessionShareServiceOptions {
  filePath?: string;
  taskService?: TaskService;
  agentService?: typeof clawdbotAgentService;
}

interface ShareAccessOptions {
  includeInactive?: boolean;
  permission?: RunSessionPermission;
  actor?: RunSessionActor;
}

const DEFAULT_WORKSPACE_ID = 'local';
const DEFAULT_MOBILE_SAFE_APPROVAL_CLASSES = ['human-review', 'task-comment', 'low-risk'];
const MAX_EVENT_HISTORY = 5000;
const LOG_CONTEXT_LIMIT = 4000;

export class RunSessionShareService {
  private readonly filePath: string;
  private readonly taskService: TaskService;
  private readonly agentService: typeof clawdbotAgentService;
  private state: RunSessionShareState | null = null;

  constructor(options: RunSessionShareServiceOptions = {}) {
    this.filePath =
      options.filePath ?? path.join(getDataDir(), 'storage', 'run-session-shares.json');
    this.taskService = options.taskService ?? getTaskService();
    this.agentService = options.agentService ?? clawdbotAgentService;
  }

  async create(
    input: CreateRunSessionShareInput,
    actor: RunSessionActor
  ): Promise<RunSessionShare> {
    const task = await this.requireTask(input.taskId);
    const now = new Date().toISOString();
    const status = this.statusFor(input.expiresAt, undefined);
    const id = `run_share_${nanoid(10)}`;
    const share: RunSessionShare = {
      id,
      workspaceId: actor.workspaceId || DEFAULT_WORKSPACE_ID,
      taskId: task.id,
      sourceType: 'task-agent',
      sourceId: task.attempt?.id ?? task.id,
      permission: input.permission,
      status,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      expiresAt: input.expiresAt,
      actorLabel: input.actorLabel,
      stablePath: `/runs/shared/${id}`,
      mobileSafeApprovalClasses: this.normalizeApprovalClasses(input.mobileSafeApprovalClasses),
      snapshot: await this.snapshotTask(task),
      forkedTaskIds: [],
    };

    const state = await this.loadState();
    state.shares.push(share);
    const event = this.createEvent(share, 'share.created', actor, {
      permission: share.permission,
      expiresAt: share.expiresAt,
    });
    state.events.push(event);
    await this.saveState(state);
    broadcastRunSessionEvent(event, { workspaceId: share.workspaceId });
    return share;
  }

  async list(
    filters: RunSessionShareListFilters = {},
    actor?: RunSessionActor
  ): Promise<RunSessionShare[]> {
    const state = await this.loadState();
    let changed = false;
    const workspaceId = actor?.workspaceId || DEFAULT_WORKSPACE_ID;
    const shares = state.shares.map((share) => {
      const status = this.statusFor(share.expiresAt, share.revokedAt);
      if (status !== share.status) {
        changed = true;
        return { ...share, status, updatedAt: new Date().toISOString() };
      }
      return share;
    });

    if (changed) {
      state.shares = shares;
      await this.saveState(state);
    }

    return shares
      .filter((share) => share.workspaceId === workspaceId)
      .filter((share) => !filters.taskId || share.taskId === filters.taskId)
      .filter((share) => !filters.status || share.status === filters.status)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async get(id: string, options: ShareAccessOptions = {}): Promise<RunSessionShare> {
    validatePathSegment(id);
    const state = await this.loadState();
    const index = state.shares.findIndex((share) => share.id === id);
    if (index < 0) throw new NotFoundError('Run session share not found');

    let share = state.shares[index];
    const status = this.statusFor(share.expiresAt, share.revokedAt);
    if (status !== share.status) {
      share = { ...share, status, updatedAt: new Date().toISOString() };
      state.shares[index] = share;
      await this.saveState(state);
    }

    this.assertWorkspace(share, options.actor);
    if (!options.includeInactive && share.status !== 'active') {
      throw new ForbiddenError('Run session share is not active', { status: share.status });
    }
    if (options.permission) this.assertSharePermission(share, options.permission);

    return share;
  }

  async update(
    id: string,
    input: UpdateRunSessionShareInput,
    actor: RunSessionActor
  ): Promise<RunSessionShare> {
    const state = await this.loadState();
    const current = await this.get(id, { actor });
    const next: RunSessionShare = {
      ...current,
      permission: input.permission ?? current.permission,
      expiresAt: input.expiresAt === null ? undefined : (input.expiresAt ?? current.expiresAt),
      actorLabel: input.actorLabel ?? current.actorLabel,
      mobileSafeApprovalClasses:
        input.mobileSafeApprovalClasses !== undefined
          ? this.normalizeApprovalClasses(input.mobileSafeApprovalClasses)
          : current.mobileSafeApprovalClasses,
      updatedAt: new Date().toISOString(),
    };
    next.status = this.statusFor(next.expiresAt, next.revokedAt);

    state.shares = state.shares.map((share) => (share.id === id ? next : share));
    const event = this.createEvent(next, 'share.updated', actor, {
      permission: next.permission,
      expiresAt: next.expiresAt,
    });
    state.events.push(event);
    await this.saveState(state);
    broadcastRunSessionEvent(event, { workspaceId: next.workspaceId });
    return next;
  }

  async revoke(id: string, actor: RunSessionActor, reason?: string): Promise<RunSessionShare> {
    const state = await this.loadState();
    const current = await this.get(id, { actor, includeInactive: true });
    const now = new Date().toISOString();
    const next: RunSessionShare = {
      ...current,
      status: 'revoked',
      revokedAt: current.revokedAt ?? now,
      revokedBy: current.revokedBy ?? actor,
      revokedReason: reason,
      updatedAt: now,
    };

    state.shares = state.shares.map((share) => (share.id === id ? next : share));
    const event = this.createEvent(next, 'share.revoked', actor, { reason });
    state.events.push(event);
    await this.saveState(state);
    broadcastRunSessionEvent(event, { workspaceId: next.workspaceId });
    return next;
  }

  async sendMessage(
    id: string,
    input: SendRunSessionMessageInput,
    actor: RunSessionActor
  ): Promise<RunSessionEvent> {
    const share = await this.get(id, { actor, permission: 'edit' });
    await this.agentService.assertActiveRunControl(share.taskId, 'message', share.sourceId);
    const delivery = await this.agentService.sendMessage(share.taskId, input.message, {
      actor: actor.label || actor.id,
      source: `run-session:${share.id}`,
      expectedAttemptId: share.sourceId,
    });
    const event = this.createEvent(share, 'message.sent', actor, {
      delivered: delivery.delivered,
      note: delivery.note,
    });
    event.message = input.message;

    const state = await this.loadState();
    state.events.push(event);
    await this.saveState(state);
    broadcastRunSessionEvent(event, { workspaceId: share.workspaceId });
    return event;
  }

  async respondToApproval(
    id: string,
    input: RunSessionApprovalResponseInput,
    actor: RunSessionActor
  ): Promise<RunSessionEvent> {
    const share = await this.get(id, { actor, permission: 'edit' });
    await this.agentService.assertActiveRunControl(share.taskId, 'approvals', share.sourceId);
    const mobileClient = actor.clientMode === 'mobile-pwa';
    if (mobileClient && !share.mobileSafeApprovalClasses.includes(input.actionClass)) {
      throw new ForbiddenError('Approval class is not mobile-safe for this share', {
        actionClass: input.actionClass,
        mobileSafeApprovalClasses: share.mobileSafeApprovalClasses,
      });
    }

    const event = this.createEvent(share, 'approval.responded', actor, {
      note: input.note,
      mobileClient,
    });
    event.actionClass = input.actionClass;
    event.approvalResponse = input.response;

    const state = await this.loadState();
    state.events.push(event);
    await this.saveState(state);
    broadcastRunSessionEvent(event, { workspaceId: share.workspaceId });
    return event;
  }

  async fork(
    id: string,
    input: ForkRunSessionInput,
    actor: RunSessionActor
  ): Promise<{
    fork: RunSessionFork;
    task: Task;
  }> {
    const share = await this.get(id, { actor, permission: 'fork' });
    const parent = await this.requireTask(share.taskId);
    const description = await this.buildForkDescription(parent, share, input.reason);
    const task = await this.taskService.createTask({
      title: input.title?.trim() || `Fork: ${parent.title}`,
      description,
      type: parent.type,
      priority: input.priority ?? parent.priority,
      project: parent.project,
      sprint: parent.sprint,
      agent: parent.agent,
      createdBy: actor.label || actor.id,
      updatedBy: actor.label || actor.id,
    });

    const fork: RunSessionFork = {
      id: `run_fork_${nanoid(10)}`,
      shareId: share.id,
      parentTaskId: parent.id,
      parentAttemptId: share.snapshot.attemptId,
      forkTaskId: task.id,
      createdAt: new Date().toISOString(),
      createdBy: actor,
      reason: input.reason,
    };

    const state = await this.loadState();
    state.forks.push(fork);
    state.shares = state.shares.map((candidate) =>
      candidate.id === share.id
        ? {
            ...candidate,
            forkedTaskIds: [...new Set([...candidate.forkedTaskIds, task.id])],
            updatedAt: new Date().toISOString(),
          }
        : candidate
    );
    const event = this.createEvent(
      { ...share, forkedTaskIds: [...share.forkedTaskIds, task.id] },
      'fork.created',
      actor,
      {
        reason: input.reason,
      }
    );
    event.forkTaskId = task.id;
    state.events.push(event);
    await this.saveState(state);
    broadcastRunSessionEvent(event, { workspaceId: share.workspaceId });
    return { fork, task };
  }

  async listEvents(shareId: string, actor?: RunSessionActor): Promise<RunSessionEvent[]> {
    const share = await this.get(shareId, { actor, includeInactive: true });
    const state = await this.loadState();
    return state.events.filter((event) => event.shareId === share.id);
  }

  private async requireTask(taskId: string): Promise<Task> {
    const task = await this.taskService.getTask(taskId);
    if (!task) throw new NotFoundError('Task not found');
    return task;
  }

  private async snapshotTask(task: Task): Promise<RunSessionSnapshot> {
    const status = await this.agentService.getAgentStatus(task.id);
    return {
      running: Boolean(status),
      taskTitle: task.title,
      attemptId: status?.attemptId ?? task.attempt?.id,
      attemptStatus: status?.status ?? task.attempt?.status,
      agent: status?.agent ?? task.attempt?.agent,
      provider: task.attempt?.provider,
      model: task.attempt?.model,
      startedAt: status?.startedAt ?? task.attempt?.started,
      worktreePath: task.git?.worktreePath ? '[redacted-worktree]' : undefined,
      artifactCount: (task.deliverables?.length ?? 0) + (task.attachments?.length ?? 0),
      blocker: task.blockedReason?.note,
    };
  }

  private normalizeApprovalClasses(classes?: string[]): string[] {
    return [...new Set([...(classes ?? DEFAULT_MOBILE_SAFE_APPROVAL_CLASSES)])].sort();
  }

  private statusFor(expiresAt?: string, revokedAt?: string): RunSessionShareStatus {
    if (revokedAt) return 'revoked';
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) return 'expired';
    return 'active';
  }

  private assertWorkspace(share: RunSessionShare, actor?: RunSessionActor): void {
    if (!actor) return;
    const actorWorkspace = actor.workspaceId || DEFAULT_WORKSPACE_ID;
    if (actorWorkspace !== share.workspaceId) {
      throw new ForbiddenError('Run session share belongs to a different workspace');
    }
  }

  private assertSharePermission(share: RunSessionShare, requested: RunSessionPermission): void {
    if (requested === 'view') return;
    if (requested === 'edit' && share.permission === 'edit') return;
    if (requested === 'fork' && share.permission === 'fork') return;
    throw new ForbiddenError('Run session share does not grant the requested permission', {
      sharePermission: share.permission,
      requested,
    });
  }

  private createEvent(
    share: RunSessionShare,
    type: RunSessionEvent['type'],
    actor: RunSessionActor,
    metadata?: Record<string, unknown>
  ): RunSessionEvent {
    return {
      id: `run_event_${nanoid(10)}`,
      shareId: share.id,
      taskId: share.taskId,
      attemptId: share.snapshot.attemptId,
      type,
      actor,
      createdAt: new Date().toISOString(),
      metadata,
    };
  }

  private async buildForkDescription(
    parent: Task,
    share: RunSessionShare,
    reason?: string
  ): Promise<string> {
    const lines = [
      `Forked from shared live run session \`${share.id}\`.`,
      '',
      `Parent task: \`${parent.id}\``,
      share.snapshot.attemptId ? `Parent attempt: \`${share.snapshot.attemptId}\`` : undefined,
      share.snapshot.agent ? `Agent: \`${share.snapshot.agent}\`` : undefined,
      share.snapshot.provider ? `Provider: \`${share.snapshot.provider}\`` : undefined,
      share.snapshot.model ? `Model: \`${share.snapshot.model}\`` : undefined,
      reason ? `Fork reason: ${this.redactForkText(reason)}` : undefined,
      '',
      'This fork intentionally does not inherit worktrees, thread IDs, credentials, or local-only handles.',
      '',
      '## Parent Context',
      '',
      this.redactForkText(parent.description || 'No parent task description.'),
    ].filter((line): line is string => typeof line === 'string');

    const attemptId = share.snapshot.attemptId;
    if (attemptId) {
      try {
        const log = await this.agentService.getAttemptLog(parent.id, attemptId);
        const excerpt = this.redactForkText(log.slice(-LOG_CONTEXT_LIMIT));
        lines.push('', '## Redacted Run Excerpt', '', '```text', excerpt, '```');
      } catch {
        lines.push('', '## Redacted Run Excerpt', '', 'No attempt log was available.');
      }
    }

    return lines.join('\n');
  }

  private redactForkText(value: string): string {
    return redactString(value)
      .replace(/\/Users\/[^/\s]+\/[^\s)]+/g, '[redacted-local-path]')
      .replace(/[A-Z]:\\Users\\[^\\\s]+\\[^\s)]+/g, '[redacted-local-path]');
  }

  private async loadState(): Promise<RunSessionShareState> {
    if (this.state) return this.state;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.state = JSON.parse(raw) as RunSessionShareState;
    } catch {
      this.state = { shares: [], events: [], forks: [] };
    }
    return this.state;
  }

  private async saveState(state: RunSessionShareState): Promise<void> {
    state.events = state.events.slice(-MAX_EVENT_HISTORY);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    this.state = state;
  }
}

let runSessionShareService: RunSessionShareService | null = null;

export function getRunSessionShareService(): RunSessionShareService {
  runSessionShareService ??= new RunSessionShareService();
  return runSessionShareService;
}

export function resetRunSessionShareServiceForTests(): void {
  runSessionShareService = null;
}
