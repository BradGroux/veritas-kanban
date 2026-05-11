import { simpleGit } from 'simple-git';
import { nanoid } from 'nanoid';
import { TaskService } from './task-service.js';
import type { ReviewComment, ReviewDecision, Task } from '@veritas-kanban/shared';

export interface CodexReviewInput {
  taskId: string;
  model?: string;
  instructions?: string;
  save?: boolean;
}

export interface CodexReviewFinding {
  file: string;
  line: number;
  severity: 'high' | 'medium' | 'low' | 'nit';
  title: string;
  message: string;
}

export interface CodexReviewResult {
  taskId: string;
  attemptId: string;
  decision: ReviewDecision;
  summary: string;
  findings: CodexReviewFinding[];
  comments: ReviewComment[];
  threadId?: string;
}

export class CodexReviewService {
  private taskService: TaskService;

  constructor() {
    this.taskService = new TaskService();
  }

  private expandPath(p: string): string {
    return p.replace(/^~/, process.env.HOME || '');
  }

  async reviewTask(input: CodexReviewInput): Promise<CodexReviewResult> {
    const task = await this.taskService.getTask(input.taskId);
    if (!task) throw new Error('Task not found');
    if (!task.git?.worktreePath) throw new Error('Task must have an active worktree to review');

    const worktreePath = this.expandPath(task.git.worktreePath);
    const baseBranch = task.git.baseBranch || 'main';
    const diff = await simpleGit(worktreePath).diff([baseBranch]);
    if (!diff.trim()) throw new Error('Task branch has no diff to review');

    const prompt = this.buildReviewPrompt(task, diff, input.instructions);
    const { Codex } = await import('@openai/codex-sdk');
    const codex = new Codex({ env: this.buildCodexEnv() });
    const thread = codex.startThread({
      workingDirectory: worktreePath,
      skipGitRepoCheck: true,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: true,
      model: input.model,
    });

    const streamed = await thread.runStreamed(prompt);
    let threadId = '';
    let finalResponse = '';
    let failureMessage = '';

    for await (const event of streamed.events) {
      if (event.type === 'thread.started') threadId = event.thread_id;
      if (event.type === 'item.completed' && event.item.type === 'agent_message') {
        finalResponse = event.item.text;
      }
      if (event.type === 'turn.failed') failureMessage = event.error.message;
      if (event.type === 'error') failureMessage = event.message;
    }

    if (failureMessage) throw new Error(`Codex review failed: ${failureMessage}`);

    const parsed = this.parseReviewResponse(finalResponse);
    const comments = parsed.findings.map((finding) => this.toReviewComment(finding));
    const attemptId = `attempt_${nanoid(8)}`;

    if (input.save !== false) {
      const now = new Date().toISOString();
      await this.taskService.updateTask(input.taskId, {
        reviewComments: [...(task.reviewComments || []), ...comments],
        review: {
          decision: parsed.decision,
          decidedAt: now,
          summary: parsed.summary,
        },
        comments: [
          ...(task.comments || []),
          {
            id: `comment_${nanoid(8)}`,
            author: 'codex-review',
            text: `Codex review: ${parsed.decision}. ${parsed.summary}`,
            timestamp: now,
          },
        ],
        attempt: {
          id: attemptId,
          agent: 'codex',
          status: 'complete',
          started: now,
          ended: now,
          provider: 'codex-review',
          model: input.model,
          threadId,
        },
      });
    }

    return {
      taskId: input.taskId,
      attemptId,
      decision: parsed.decision,
      summary: parsed.summary,
      findings: parsed.findings,
      comments,
      threadId,
    };
  }

  private buildReviewPrompt(task: Task, diff: string, instructions?: string): string {
    return [
      'You are reviewing a Veritas Kanban task branch.',
      'Prioritize correctness, regressions, missing tests, security, data loss, and release blockers.',
      'Return only JSON with this shape:',
      '{"decision":"approved|changes-requested|rejected","summary":"string","findings":[{"file":"path","line":1,"severity":"high|medium|low|nit","title":"string","message":"string"}]}',
      '',
      `Task: ${task.id} - ${task.title}`,
      `Priority: ${task.priority}`,
      instructions ? `Extra instructions: ${instructions}` : '',
      '',
      'Diff:',
      '```diff',
      diff.slice(0, 120_000),
      '```',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private parseReviewResponse(response: string): {
    decision: ReviewDecision;
    summary: string;
    findings: CodexReviewFinding[];
  } {
    const json = this.extractJson(response);
    try {
      const parsed = JSON.parse(json) as {
        decision?: ReviewDecision;
        summary?: string;
        findings?: Partial<CodexReviewFinding>[];
      };
      return {
        decision: this.normalizeDecision(parsed.decision),
        summary: parsed.summary || 'Codex review completed.',
        findings: (parsed.findings || []).map((finding) => ({
          file: finding.file || 'CODEX_REVIEW.md',
          line: Math.max(1, Number(finding.line || 1)),
          severity: this.normalizeSeverity(finding.severity),
          title: finding.title || 'Codex review finding',
          message: finding.message || 'Review finding did not include details.',
        })),
      };
    } catch {
      return {
        decision: 'changes-requested',
        summary: 'Codex returned an unstructured review response.',
        findings: [
          {
            file: 'CODEX_REVIEW.md',
            line: 1,
            severity: 'medium',
            title: 'Unstructured Codex review',
            message: response || 'Codex review did not return content.',
          },
        ],
      };
    }
  }

  private extractJson(response: string): string {
    const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return (fenced?.[1] || response).trim();
  }

  private normalizeDecision(decision: unknown): ReviewDecision {
    if (decision === 'approved' || decision === 'changes-requested' || decision === 'rejected') {
      return decision;
    }
    return 'changes-requested';
  }

  private normalizeSeverity(severity: unknown): CodexReviewFinding['severity'] {
    if (severity === 'high' || severity === 'medium' || severity === 'low' || severity === 'nit') {
      return severity;
    }
    return 'medium';
  }

  private toReviewComment(finding: CodexReviewFinding): ReviewComment {
    return {
      id: `review_${nanoid(8)}`,
      file: finding.file,
      line: finding.line,
      content: `[${finding.severity}] ${finding.title}: ${finding.message}`,
      created: new Date().toISOString(),
    };
  }

  private buildCodexEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value;
    }
    env.VK_API_URL = process.env.VK_API_URL || 'http://localhost:3001';
    return env;
  }
}
