import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CreateWorkProductInput,
  UpdateWorkProductInput,
  WorkProduct,
  WorkProductListOptions,
  WorkProductMaintenancePreview,
  WorkProductMaintenancePreviewItem,
  WorkProductPreview,
  WorkProductPrimitive,
  WorkProductRedaction,
  WorkProductRender,
  WorkProductVersion,
  Task,
  WorkflowPipelineSummary,
} from '@veritas-kanban/shared';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteWorkProductRepository } from '../storage/sqlite/work-product-repository.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '.veritas-kanban');
const DEFAULT_VERSION_LIMIT = 25;

interface WorkProductFileState {
  products: WorkProduct[];
  versions: WorkProductVersion[];
}

export interface WorkProductServiceOptions {
  dataDir?: string;
  filePath?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
  versionLimit?: number;
}

export class WorkProductService {
  private readonly filePath: string;
  private readonly versionLimit: number;
  private readonly repository: SqliteWorkProductRepository | null = null;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;
  private loaded = false;
  private fileState: WorkProductFileState = { products: [], versions: [] };

  constructor(options: WorkProductServiceOptions = {}) {
    const dataDir = options.dataDir ?? DATA_DIR;
    this.filePath = options.filePath ?? path.join(dataDir, 'work-products.json');
    this.versionLimit = options.versionLimit ?? DEFAULT_VERSION_LIMIT;
    const storageType =
      options.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteWorkProductRepository(this.sqliteDatabase, {
        versionLimit: this.versionLimit,
      });
    }
  }

  async create(input: CreateWorkProductInput): Promise<WorkProduct> {
    this.assertRenderKind(input.kind, input.render);

    const now = new Date().toISOString();
    const product: WorkProduct = {
      id: `wp_${randomUUID()}`,
      workspaceId: input.workspaceId ?? 'local',
      kind: input.kind,
      title: input.title,
      status: 'active',
      render: input.render,
      version: 1,
      taskId: input.taskId,
      sourceRunId: input.sourceRunId,
      agent: input.agent,
      model: input.model,
      redaction: input.redaction,
      sourceLinks: input.sourceLinks,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };

    if (this.repository) {
      return this.repository.save(product, this.extractSearchText(product), input.changeSummary);
    }

    await this.ensureLoaded();
    this.fileState.products.push(product);
    this.fileState.versions.push(this.createVersion(product, 'create', input.changeSummary));
    this.pruneFileVersions(product.id);
    await this.saveFileState();
    return product;
  }

  async list(options: WorkProductListOptions = {}): Promise<WorkProduct[]> {
    if (this.repository) {
      return this.repository.list(options);
    }

    await this.ensureLoaded();
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
    const query = options.query?.toLowerCase();
    return this.fileState.products
      .filter((product) => {
        if (!options.includeArchived && product.status !== 'active') return false;
        if (options.status && product.status !== options.status) return false;
        if (options.taskId && product.taskId !== options.taskId) return false;
        if (options.sourceRunId && product.sourceRunId !== options.sourceRunId) return false;
        if (options.agent && product.agent !== options.agent) return false;
        if (options.kind && product.kind !== options.kind) return false;
        if (query) {
          const haystack = `${product.title}\n${this.extractSearchText(product)}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  async get(id: string): Promise<WorkProduct | null> {
    if (this.repository) {
      return this.repository.get(id);
    }

    await this.ensureLoaded();
    return this.fileState.products.find((product) => product.id === id) ?? null;
  }

  async update(id: string, input: UpdateWorkProductInput): Promise<WorkProduct | null> {
    const current = await this.get(id);
    if (!current) return null;

    if (input.render) {
      this.assertRenderKind(input.render.kind, input.render);
    }

    const now = new Date().toISOString();
    const { changeType: requestedChangeType, changeSummary, ...productPatch } = input;
    const next: WorkProduct = {
      ...current,
      ...productPatch,
      kind: input.render?.kind ?? current.kind,
      render: input.render ?? current.render,
      version: current.version + 1,
      updatedAt: now,
      archivedAt: input.status === 'archived' ? (current.archivedAt ?? now) : undefined,
    };
    const changeType = requestedChangeType ?? (input.render ? 'refine' : 'manual');

    if (this.repository) {
      return this.repository.update(next, this.extractSearchText(next), changeType, changeSummary);
    }

    await this.ensureLoaded();
    const index = this.fileState.products.findIndex((product) => product.id === id);
    if (index === -1) return null;

    this.fileState.products[index] = next;
    this.fileState.versions.push(this.createVersion(next, changeType, changeSummary));
    this.pruneFileVersions(id);
    await this.saveFileState();
    return next;
  }

  async archive(id: string): Promise<WorkProduct | null> {
    if (this.repository) {
      return this.repository.archive(id, new Date().toISOString());
    }
    return this.update(id, {
      status: 'archived',
      changeType: 'manual',
      changeSummary: 'Archived work product',
    });
  }

  async listVersions(productId: string): Promise<WorkProductVersion[]> {
    if (this.repository) {
      return this.repository.listVersions(productId);
    }

    await this.ensureLoaded();
    return this.fileState.versions
      .filter((version) => version.productId === productId)
      .sort((a, b) => b.version - a.version);
  }

  async restoreVersion(productId: string, versionNumber: number): Promise<WorkProduct | null> {
    const product = await this.get(productId);
    if (!product) return null;

    const version = this.repository
      ? this.repository.getVersion(productId, versionNumber)
      : ((await this.listVersions(productId)).find(
          (candidate) => candidate.version === versionNumber
        ) ?? null);
    if (!version) return null;

    return this.update(productId, {
      title: version.title,
      render: version.render,
      agent: version.agent,
      model: version.model,
      redaction: version.redaction,
      changeType: 'restore',
      changeSummary: `Restored version ${versionNumber}`,
    });
  }

  async search(query: string, limit = 20): Promise<WorkProduct[]> {
    if (this.repository) {
      return this.repository.search(query, limit);
    }
    return this.list({ query, limit });
  }

  async maintenancePreview(): Promise<WorkProductMaintenancePreview> {
    const products = await this.listMaintenanceProducts();
    const items = await Promise.all(
      products.map(async (product) => this.toMaintenancePreviewItem(product))
    );
    const byKind = Array.from(
      items
        .reduce((groups, item) => {
          const current = groups.get(item.kind) ?? {
            kind: item.kind,
            products: 0,
            versions: 0,
            estimatedBytes: 0,
          };
          current.products += 1;
          current.versions += item.versionCount;
          current.estimatedBytes += item.estimatedBytes;
          groups.set(item.kind, current);
          return groups;
        }, new Map<WorkProduct['kind'], WorkProductMaintenancePreview['byKind'][number]>())
        .values()
    ).sort((a, b) => b.estimatedBytes - a.estimatedBytes || a.kind.localeCompare(b.kind));

    const cleanupCandidates = items.filter((item) => item.cleanupEligible);
    const retained = items.filter((item) => !item.cleanupEligible);

    return {
      generatedAt: new Date().toISOString(),
      workspaceId: 'local',
      totals: {
        products: items.length,
        active: items.filter((item) => item.status === 'active').length,
        archived: items.filter((item) => item.status === 'archived').length,
        versions: items.reduce((sum, item) => sum + item.versionCount, 0),
        cleanupCandidates: cleanupCandidates.length,
        estimatedBytes: items.reduce((sum, item) => sum + item.estimatedBytes, 0),
      },
      byKind,
      cleanupCandidates,
      retained,
      notes: [
        'Preview only. No work products or version history are deleted by this endpoint.',
        'Archived work products are cleanup candidates; active work products are retained.',
        'Byte counts are JSON storage estimates for product metadata, render payloads, and versions.',
      ],
    };
  }

  async generateCompletionPacket(
    task: Task,
    options: { sourceRunId?: string; changeSummary?: string } = {}
  ): Promise<WorkProduct> {
    const sourceRunId = options.sourceRunId ?? this.completionPacketSourceRunId(task);
    const input = this.buildCompletionPacketInput(task, sourceRunId);
    const existing = (
      await this.list({
        taskId: task.id,
        kind: 'report',
        includeArchived: true,
        limit: 200,
      })
    ).find((product) => product.metadata?.packetType === 'completion_packet');

    if (existing) {
      const updated = await this.update(existing.id, {
        ...input,
        status: 'active',
        changeType: 'regenerate',
        changeSummary:
          options.changeSummary ??
          `Regenerated completion packet for task revision ${task.revision ?? 'unknown'}`,
      });
      if (updated) return updated;
    }

    return this.create({
      ...input,
      changeSummary: options.changeSummary ?? 'Generated completion packet',
    });
  }

  toPreview(product: WorkProduct): WorkProductPreview {
    const rawText = this.extractSearchText(product);
    const redactedText = this.redactText(rawText, product.redaction);
    const fullyRedacted = this.shouldFullyRedact(product.redaction);
    return {
      id: product.id,
      workspaceId: product.workspaceId,
      kind: product.kind,
      title: product.title,
      status: product.status,
      version: product.version,
      taskId: product.taskId,
      sourceRunId: product.sourceRunId,
      agent: product.agent,
      model: product.model,
      sourceLinks: product.sourceLinks,
      redacted: fullyRedacted || redactedText !== rawText,
      snippet: (fullyRedacted ? '[redacted work product preview]' : redactedText).slice(0, 500),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private async listMaintenanceProducts(): Promise<WorkProduct[]> {
    if (this.repository) {
      return this.repository.listForMaintenance();
    }

    await this.ensureLoaded();
    return [...this.fileState.products].sort(
      (a, b) =>
        a.status.localeCompare(b.status) ||
        a.updatedAt.localeCompare(b.updatedAt) ||
        a.id.localeCompare(b.id)
    );
  }

  private async toMaintenancePreviewItem(
    product: WorkProduct
  ): Promise<WorkProductMaintenancePreviewItem> {
    const versions = await this.listVersions(product.id);
    const redacted = this.toPreview(product).redacted;
    const cleanupEligible = product.status === 'archived';

    return {
      id: product.id,
      workspaceId: product.workspaceId,
      title: product.title,
      kind: product.kind,
      status: product.status,
      taskId: product.taskId,
      sourceRunId: product.sourceRunId,
      version: product.version,
      versionCount: versions.length,
      sourceLinkCount: product.sourceLinks?.length ?? 0,
      redacted,
      cleanupEligible,
      retainedReason: this.maintenanceRetainedReason(product, versions.length),
      estimatedBytes: this.estimateWorkProductBytes(product, versions),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      archivedAt: product.archivedAt,
    };
  }

  private maintenanceRetainedReason(product: WorkProduct, versionCount: number): string {
    if (product.status === 'active') {
      if (product.taskId) return 'Active work product linked to a task.';
      if (product.sourceRunId) return 'Active work product linked to a run.';
      return 'Active work product.';
    }

    if (versionCount > 1) return 'Archived work product with restorable version history.';
    return 'Archived generated output eligible for explicit cleanup.';
  }

  private estimateWorkProductBytes(product: WorkProduct, versions: WorkProductVersion[]): number {
    return (
      Buffer.byteLength(JSON.stringify(product), 'utf8') +
      versions.reduce((sum, version) => sum + Buffer.byteLength(JSON.stringify(version), 'utf8'), 0)
    );
  }

  exportProduct(
    product: WorkProduct,
    options: { format?: 'markdown' | 'json'; redacted?: boolean } = {}
  ): string {
    const redacted = options.redacted ?? product.redaction?.exportDefault !== 'full';
    if (options.format === 'json') {
      const exported = redacted ? this.redactProduct(product) : product;
      return JSON.stringify(exported, null, 2);
    }

    const body = redacted
      ? this.redactText(this.extractSearchText(product), product.redaction)
      : this.extractSearchText(product);
    const lines = [
      `# ${product.title}`,
      '',
      `Kind: ${product.kind}`,
      `Version: ${product.version}`,
      product.taskId ? `Task: ${product.taskId}` : null,
      product.sourceRunId ? `Run: ${product.sourceRunId}` : null,
      product.agent ? `Agent: ${product.agent}` : null,
      product.model ? `Model: ${product.model}` : null,
      `Updated: ${product.updatedAt}`,
      '',
      body,
    ].filter((line): line is string => line !== null);
    return `${lines.join('\n')}\n`;
  }

  private buildCompletionPacketInput(task: Task, sourceRunId?: string): CreateWorkProductInput {
    const sourceLinks = this.buildCompletionPacketSourceLinks(task, sourceRunId);
    const render: WorkProductRender = {
      schemaVersion: 1,
      kind: 'report',
      summary: this.completionSummary(task),
      sections: [
        { heading: 'Delivered', body: this.deliveredSection(task) },
        { heading: 'Changed Files And Sources', body: this.changedFilesSection(task) },
        { heading: 'Verification Evidence', body: this.verificationSection(task) },
        { heading: 'Orchestration Pipeline', body: this.orchestrationSection(task) },
        { heading: 'Review And Approval', body: this.reviewSection(task) },
        { heading: 'Cost And Duration', body: this.costDurationSection(task) },
        { heading: 'Deliverables And Attachments', body: this.deliverablesSection(task) },
        { heading: 'Unresolved Risks', body: this.risksSection(task) },
      ],
    };

    return {
      kind: 'report',
      title: `Completion Packet: ${task.title}`,
      render,
      taskId: task.id,
      sourceRunId,
      agent: task.attempt?.agent ?? (task.agent === 'auto' ? undefined : task.agent),
      model: task.attempt?.model,
      redaction: {
        level: 'standard',
        containsSensitiveContent: false,
        sensitiveFields: ['local paths', 'tokens', 'secrets'],
        notes: [
          'Completion packets intentionally summarize evidence instead of embedding raw logs.',
        ],
        exportDefault: 'redacted',
      },
      sourceLinks,
      metadata: this.completionPacketMetadata(task, sourceRunId),
    };
  }

  private completionPacketSourceRunId(task: Task): string | undefined {
    if (task.attempt?.id) return task.attempt.id;
    return [...(task.attempts ?? [])].reverse().find((attempt) => attempt.status === 'complete')
      ?.id;
  }

  private completionPacketMetadata(
    task: Task,
    sourceRunId?: string
  ): Record<string, WorkProductPrimitive> {
    return {
      packetType: 'completion_packet',
      taskStatus: task.status,
      generatedFromRevision: task.revision ?? null,
      generatedFromTaskUpdatedAt: task.updated,
      sourceRunId: sourceRunId ?? null,
      verificationTotal: task.verificationSteps?.length ?? 0,
      verificationPassed: task.verificationSteps?.filter((step) => step.checked).length ?? 0,
      deliverableCount: task.deliverables?.length ?? 0,
      attachmentCount: task.attachments?.length ?? 0,
      reviewDecision: task.review?.decision ?? null,
      qaGatePassed: task.qaGate?.passed ?? null,
      orchestrationRoles: task.attempt?.orchestration?.totals.roles ?? 0,
      orchestrationBlocked: task.attempt?.orchestration?.totals.blocked ?? 0,
      orchestrationFailed: task.attempt?.orchestration?.totals.failed ?? 0,
      budgetDecision: task.attempt?.budget?.decision ?? null,
      budgetTraceCount: task.attempt?.budget?.traceIds.length ?? 0,
    };
  }

  private buildCompletionPacketSourceLinks(
    task: Task,
    sourceRunId?: string
  ): CreateWorkProductInput['sourceLinks'] {
    const links: NonNullable<CreateWorkProductInput['sourceLinks']> = [
      {
        label: 'Task',
        href: `veritas://task/${encodeURIComponent(task.id)}?tab=work-products`,
        type: 'task',
      },
    ];

    if (sourceRunId) {
      links.push({
        label: 'Run timeline',
        href: `veritas://task/${encodeURIComponent(task.id)}?tab=timeline&attempt=${encodeURIComponent(sourceRunId)}`,
        type: 'run',
      });
    }

    if (task.git?.prUrl) {
      links.push({
        label: `PR ${task.git.prNumber ?? ''}`.trim(),
        href: task.git.prUrl,
        type: 'pr',
      });
    }

    if (task.github?.url) {
      links.push({
        label: `Issue #${task.github.issueNumber}`,
        href: task.github.url,
        type: 'url',
      });
    }

    return links;
  }

  private completionSummary(task: Task): string {
    const status = task.status === 'done' ? 'completed' : task.status;
    const review = task.review?.decision ? ` Review: ${task.review.decision}.` : '';
    const verificationTotal = task.verificationSteps?.length ?? 0;
    const verificationPassed = task.verificationSteps?.filter((step) => step.checked).length ?? 0;
    const verification =
      verificationTotal > 0
        ? ` Verification: ${verificationPassed}/${verificationTotal} checks complete.`
        : ' Verification evidence is missing.';
    return this.packetText(`${task.title} is ${status}.${review}${verification}`);
  }

  private deliveredSection(task: Task): string {
    const lines = [
      `Task: ${task.title}`,
      task.description ? `Objective: ${task.description}` : 'Objective: No description recorded.',
      task.automation?.result ? `Agent result: ${task.automation.result}` : null,
      task.attempt?.status ? `Latest attempt: ${task.attempt.status}` : null,
    ].filter((line): line is string => Boolean(line));
    return this.packetText(lines.join('\n'));
  }

  private changedFilesSection(task: Task): string {
    const changedFiles = new Set<string>();
    for (const deliverable of task.deliverables ?? []) {
      if (deliverable.path) changedFiles.add(deliverable.path);
    }
    for (const comment of task.reviewComments ?? []) {
      if (comment.file) changedFiles.add(`${comment.file}:${comment.line}`);
    }

    const lines = [
      task.git?.repo ? `Repository: ${task.git.repo}` : 'Repository: Not recorded.',
      task.git?.branch || task.git?.baseBranch
        ? `Branch: ${task.git.branch || task.git.baseBranch}`
        : 'Branch: Not recorded.',
      task.git?.prUrl ? `Pull request: ${task.git.prUrl}` : 'Pull request: Not recorded.',
      task.git?.worktreePath ? `Worktree: ${task.git.worktreePath}` : 'Worktree: Not recorded.',
      '',
      changedFiles.size > 0
        ? this.markdownList([...changedFiles].slice(0, 50))
        : 'No changed files were recorded on the task.',
    ];
    return this.packetText(lines.join('\n'));
  }

  private verificationSection(task: Task): string {
    const steps = task.verificationSteps ?? [];
    if (steps.length === 0) {
      return 'No verification steps were recorded. Treat this completion packet as missing verification evidence.';
    }

    const lines = steps.map(
      (step) =>
        `${step.checked ? '[x]' : '[ ]'} ${step.description}${step.checkedAt ? ` (${step.checkedAt})` : ''}`
    );
    const unchecked = steps.filter((step) => !step.checked).length;
    if (unchecked > 0) {
      lines.push(
        '',
        `${unchecked} verification step${unchecked === 1 ? '' : 's'} still unchecked.`
      );
    }
    return this.packetText(lines.join('\n'));
  }

  private orchestrationSection(task: Task): string {
    const orchestration = task.attempt?.orchestration;
    if (!orchestration) {
      return 'No orchestrator/subagent pipeline summary was recorded for this task attempt.';
    }

    const lines = [
      `Mode: ${orchestration.mode}`,
      orchestration.parentAgent ? `Parent agent: ${orchestration.parentAgent}` : null,
      `Completion policy: ${orchestration.completion}`,
      orchestration.handoff ? `Handoff: ${orchestration.handoff}` : null,
      `Roles: ${orchestration.totals.completed}/${orchestration.totals.roles} completed, ${orchestration.totals.blocked} blocked, ${orchestration.totals.failed} failed.`,
      '',
      ...orchestration.roles.map((role) => this.orchestrationRoleLine(role)),
    ].filter((line): line is string => line !== null);

    const blockers = orchestration.roles.filter(
      (role) => role.status === 'blocked' || role.status === 'failed'
    );
    if (blockers.length > 0) {
      lines.push(
        '',
        'Blockers:',
        this.markdownList(
          blockers.map((role) => `${role.label} is ${role.status}: ${role.deliverable}`)
        )
      );
    }

    return this.packetText(lines.join('\n'));
  }

  private orchestrationRoleLine(role: WorkflowPipelineSummary['roles'][number]): string {
    const verification =
      role.verification.length > 0
        ? `${role.verification.length} verification step(s)`
        : 'no verification steps';
    const duration = this.formatDurationSeconds(role.telemetry.durationSeconds);
    return `- ${role.label} (${role.agent}) is ${role.status}. Scope: ${role.scope}. Deliverable: ${role.deliverable}. Verification: ${verification}. Duration: ${duration}`;
  }

  private reviewSection(task: Task): string {
    const lines = [
      task.review?.decision ? `Decision: ${task.review.decision}` : 'Decision: Not recorded.',
      task.review?.summary ? `Summary: ${task.review.summary}` : null,
      task.reviewScores ? `Review scores: ${task.reviewScores.join('/')}` : null,
      `Review comments: ${task.reviewComments?.length ?? 0}`,
      task.qaGate?.required
        ? `QA gate: ${task.qaGate.passed ? 'passed' : 'required and not passed'}`
        : 'QA gate: Not required.',
    ].filter((line): line is string => Boolean(line));
    return this.packetText(lines.join('\n'));
  }

  private costDurationSection(task: Task): string {
    const attemptDurationMs =
      task.attempt?.started && task.attempt?.ended
        ? new Date(task.attempt.ended).getTime() - new Date(task.attempt.started).getTime()
        : undefined;
    const lines = [
      `Tracked time: ${this.formatDurationSeconds(task.timeTracking?.totalSeconds)}`,
      `Attempt duration: ${this.formatDurationMs(attemptDurationMs)}`,
      `Actual cost: ${this.formatCost(task.actualCost)}`,
      task.costPrediction
        ? `Predicted cost: ${this.formatCost(task.costPrediction.estimatedCost)} (${task.costPrediction.confidence} confidence)`
        : 'Predicted cost: Not recorded.',
      ...this.budgetLines(task),
    ];
    return this.packetText(lines.join('\n'));
  }

  private budgetLines(task: Task): string[] {
    const budget = task.attempt?.budget;
    if (!budget?.enabled) return ['Run budget: Not enforced.'];
    const usage = budget.usage;
    const limits = budget.policy?.limits ?? {};
    const used = [
      `tokens ${usage.totalTokens.toLocaleString()}${limits.totalTokens ? `/${limits.totalTokens.toLocaleString()}` : ''}`,
      `cost ${this.formatCost(usage.costUsd)}${limits.costUsd ? `/${this.formatCost(limits.costUsd)}` : ''}`,
      `tools ${usage.toolCalls.toLocaleString()}${limits.toolCalls ? `/${limits.toolCalls.toLocaleString()}` : ''}`,
      `runtime ${this.formatDurationSeconds(usage.runtimeSeconds)}${limits.runtimeSeconds ? `/${this.formatDurationSeconds(limits.runtimeSeconds)}` : ''}`,
      `retries ${usage.retries.toLocaleString()}${limits.retries ? `/${limits.retries.toLocaleString()}` : ''}`,
      `fan-out ${usage.fanOut.toLocaleString()}${limits.fanOut ? `/${limits.fanOut.toLocaleString()}` : ''}`,
    ].join(', ');
    const thresholdEvents =
      budget.thresholdEvents.length > 0
        ? budget.thresholdEvents.map((event) => event.message).join(' ')
        : 'No threshold events.';
    const traces =
      budget.traceIds.length > 0 ? ` Budget traces: ${budget.traceIds.join(', ')}.` : '';
    const override = budget.overrideReason ? ` Override: ${budget.overrideReason}.` : '';
    return [
      `Run budget: ${budget.decision}. Used ${used}.`,
      `Budget thresholds: ${thresholdEvents}.${traces}${override}`,
    ];
  }

  private deliverablesSection(task: Task): string {
    const deliverables = task.deliverables ?? [];
    const attachments = task.attachments ?? [];
    const lines = [
      'Deliverables:',
      deliverables.length > 0
        ? this.markdownList(
            deliverables.map(
              (deliverable) =>
                `${deliverable.title} (${deliverable.status})${deliverable.path ? ` - ${deliverable.path}` : ''}`
            )
          )
        : 'No deliverables recorded.',
      '',
      'Attachments:',
      attachments.length > 0
        ? this.markdownList(
            attachments.map(
              (attachment) =>
                `${attachment.originalName || attachment.filename} (${attachment.mimeType}, ${attachment.validationStatus ?? 'unknown'})`
            )
          )
        : 'No attachments recorded.',
    ];
    return this.packetText(lines.join('\n'));
  }

  private risksSection(task: Task): string {
    const risks = [
      task.blockedReason
        ? `Blocked reason remains recorded: ${task.blockedReason.category}${task.blockedReason.note ? ` - ${task.blockedReason.note}` : ''}`
        : null,
      task.qaGate?.required && !task.qaGate.passed ? 'QA gate is required and not passed.' : null,
      ...(task.verificationSteps ?? [])
        .filter((step) => !step.checked)
        .map((step) => `Unchecked verification: ${step.description}`),
      task.review?.decision && task.review.decision !== 'approved'
        ? `Review decision is ${task.review.decision}.`
        : null,
    ].filter((risk): risk is string => Boolean(risk));

    return this.packetText(
      risks.length > 0 ? this.markdownList(risks) : 'No unresolved risks were recorded.'
    );
  }

  private markdownList(items: string[]): string {
    return items.map((item) => `- ${item}`).join('\n');
  }

  private packetText(text: string): string {
    return this.redactText(text, {
      level: 'standard',
      sensitiveFields: ['tokens', 'secrets', 'local paths'],
    });
  }

  private formatCost(value?: number): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not recorded.';
    if (value === 0) return '$0';
    return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
  }

  private formatDurationMs(value?: number): string {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Not recorded.';
    return this.formatDurationSeconds(Math.round(value / 1000));
  }

  private formatDurationSeconds(value?: number): string {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'Not recorded.';
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = Math.floor(value % 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
    this.loaded = false;
    this.fileState = { products: [], versions: [] };
  }

  extractSearchText(product: WorkProduct): string {
    return renderToText(product.render);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as WorkProductFileState | WorkProduct[];
      this.fileState = Array.isArray(parsed) ? { products: parsed, versions: [] } : parsed;
    } catch {
      this.fileState = { products: [], versions: [] };
    }

    this.loaded = true;
  }

  private async saveFileState(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.fileState, null, 2));
  }

  private createVersion(
    product: WorkProduct,
    changeType: WorkProductVersion['changeType'],
    changeSummary?: string
  ): WorkProductVersion {
    return {
      id: `wpv_${randomUUID()}`,
      productId: product.id,
      workspaceId: product.workspaceId,
      version: product.version,
      changeType,
      changeSummary,
      render: product.render,
      title: product.title,
      kind: product.kind,
      agent: product.agent,
      model: product.model,
      redaction: product.redaction,
      createdAt: product.updatedAt,
    };
  }

  private pruneFileVersions(productId: string): void {
    const versions = this.fileState.versions
      .filter((version) => version.productId === productId)
      .sort((a, b) => b.version - a.version);
    const keep = new Set(versions.slice(0, this.versionLimit).map((version) => version.id));
    this.fileState.versions = this.fileState.versions.filter(
      (version) => version.productId !== productId || keep.has(version.id)
    );
  }

  private assertRenderKind(kind: string, render: WorkProductRender): void {
    if (kind !== render.kind) {
      throw new Error('Work product kind must match render.kind');
    }
  }

  private shouldFullyRedact(redaction?: WorkProductRedaction): boolean {
    return redaction?.level === 'strict' || redaction?.containsSensitiveContent === true;
  }

  private redactProduct(product: WorkProduct): WorkProduct {
    if (this.shouldFullyRedact(product.redaction)) {
      return {
        ...product,
        render: redactRender(product.render, '[redacted work product content]'),
      };
    }

    return {
      ...product,
      render: redactRender(
        product.render,
        this.redactText(this.extractSearchText(product), product.redaction)
      ),
    };
  }

  private redactText(text: string, redaction?: WorkProductRedaction): string {
    if (this.shouldFullyRedact(redaction)) {
      return '[redacted work product content]';
    }

    return text
      .replace(
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        '[redacted-private-key]'
      )
      .replace(
        /\b(?:sk|rk|ghp|gho|github_pat|xoxb|xoxp)_[A-Za-z0-9_:-]{12,}\b/g,
        '[redacted-token]'
      )
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted-token]')
      .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s]+/gi, '$1=[redacted]')
      .replace(/\/Users\/[^/\s]+\/[^\s)]+/g, '[redacted-local-path]')
      .replace(/[A-Z]:\\Users\\[^\\\s]+\\[^\s)]+/g, '[redacted-local-path]');
  }
}

function renderToText(render: WorkProductRender): string {
  switch (render.kind) {
    case 'text':
      return render.text;
    case 'markdown':
      return render.markdown;
    case 'summary':
      return [
        render.summary,
        ...(render.keyPoints ?? []),
        ...(render.sections ?? []).flatMap((section) => [section.heading, section.body]),
      ].join('\n');
    case 'checklist':
      return render.items
        .map(
          (item) =>
            `${item.checked ? '[x]' : '[ ]'} ${item.label}${item.notes ? ` - ${item.notes}` : ''}`
        )
        .join('\n');
    case 'report':
      return [
        render.summary,
        ...render.sections.flatMap((section) => [section.heading, section.body]),
      ].join('\n');
    case 'table':
      return [
        render.columns.map((column) => column.label).join('\t'),
        ...render.rows.map((row) =>
          render.columns.map((column) => String(row[column.key] ?? '')).join('\t')
        ),
      ].join('\n');
    case 'dashboard':
      return render.widgets
        .map((widget) =>
          [
            widget.title,
            widget.value === undefined ? null : String(widget.value),
            widget.description,
          ]
            .filter((part): part is string => Boolean(part))
            .join(': ')
        )
        .join('\n');
  }
}

function redactRender(render: WorkProductRender, text: string): WorkProductRender {
  switch (render.kind) {
    case 'text':
      return { schemaVersion: 1, kind: 'text', text };
    case 'markdown':
      return { schemaVersion: 1, kind: 'markdown', markdown: text };
    case 'summary':
      return { schemaVersion: 1, kind: 'summary', summary: text };
    case 'checklist':
      return {
        schemaVersion: 1,
        kind: 'checklist',
        items: [{ id: 'redacted', label: text, checked: false }],
      };
    case 'report':
      return { schemaVersion: 1, kind: 'report', summary: text, sections: [] };
    case 'table':
      return {
        schemaVersion: 1,
        kind: 'table',
        columns: [{ key: 'redacted', label: 'Redacted' }],
        rows: [{ redacted: text }],
      };
    case 'dashboard':
      return {
        schemaVersion: 1,
        kind: 'dashboard',
        widgets: [{ id: 'redacted', title: 'Redacted', description: text }],
      };
  }
}

let workProductServiceInstance: WorkProductService | null = null;

export function getWorkProductService(): WorkProductService {
  if (!workProductServiceInstance) {
    workProductServiceInstance = new WorkProductService();
  }
  return workProductServiceInstance;
}

export function resetWorkProductServiceForTests(): void {
  workProductServiceInstance?.dispose();
  workProductServiceInstance = null;
}
