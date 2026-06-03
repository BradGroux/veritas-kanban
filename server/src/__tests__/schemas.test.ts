/**
 * Schema Validation Tests
 * Tests all Zod schemas to ensure they validate correctly and reject invalid data.
 */
import { describe, it, expect } from 'vitest';
import {
  TaskIdSchema,
  TaskIdParamsSchema,
  positiveInt,
  optionalPositiveInt,
  nonEmptyString,
  isoDateString,
  optionalIsoDate,
  filePathSchema,
  TelemetryEventTypeSchema,
  MetricsPeriodSchema,
} from '../schemas/common.js';
import {
  ConflictParamsSchema,
  ConflictFileQuerySchema,
  ResolveConflictBodySchema,
  ContinueMergeBodySchema,
} from '../schemas/conflicts-schemas.js';
import { DiffParamsSchema, DiffFileQuerySchema } from '../schemas/diff-schemas.js';
import { FeatureSettingsPatchSchema } from '../schemas/feature-settings-schema.js';
import {
  MetricsQuerySchema,
  TaskMetricsQuerySchema,
  BudgetMetricsQuerySchema,
  AgentComparisonQuerySchema,
  VelocityQuerySchema,
} from '../schemas/metrics-schemas.js';
import { PreviewParamsSchema, PreviewOutputQuerySchema } from '../schemas/preview-schemas.js';
import {
  TelemetryEventsQuerySchema,
  TelemetryTaskParamsSchema,
  TelemetryCountQuerySchema,
  TelemetryBulkQuerySchema,
  TelemetryEventIngestionSchema,
  TelemetryExportQuerySchema,
} from '../schemas/telemetry-schemas.js';
import {
  ReorderTasksBodySchema,
  ApplyTemplateBodySchema,
} from '../schemas/task-mutation-schemas.js';
import { AddTimeEntryBodySchema } from '../schemas/time-schemas.js';
import { BulkArchiveBodySchema } from '../schemas/archive-schemas.js';
import {
  SetDefaultAgentBodySchema,
  ValidateRepoPathBodySchema,
} from '../schemas/config-schemas.js';
import {
  StartAgentBodySchema,
  CompleteAgentBodySchema,
  ReportTokensBodySchema,
} from '../schemas/agent-schemas.js';
import {
  AuthSetupBodySchema,
  AuthLoginBodySchema,
  AuthRecoverBodySchema,
  AuthChangePasswordBodySchema,
  AuthRotateSecretBodySchema,
} from '../schemas/auth-schemas.js';

describe('Common Schemas', () => {
  describe('TaskIdSchema', () => {
    it('should accept valid task IDs', () => {
      expect(TaskIdSchema.parse('task_20260128_abc123')).toBe('task_20260128_abc123');
      expect(TaskIdSchema.parse('task_20260115_x7Y2pQ')).toBe('task_20260115_x7Y2pQ');
    });

    it('should accept legacy format', () => {
      expect(TaskIdSchema.parse('task_legacy_id')).toBe('task_legacy_id');
    });

    it('should reject invalid task IDs', () => {
      expect(() => TaskIdSchema.parse('')).toThrow();
      expect(() => TaskIdSchema.parse('abc')).toThrow();
      expect(() => TaskIdSchema.parse('not_a_task')).toThrow();
    });
  });

  describe('TaskIdParamsSchema', () => {
    it('should validate params with taskId', () => {
      const result = TaskIdParamsSchema.parse({ taskId: 'task_20260128_abc123' });
      expect(result.taskId).toBe('task_20260128_abc123');
    });
  });

  describe('positiveInt', () => {
    it('should accept positive integers', () => {
      expect(positiveInt().parse(1)).toBe(1);
      expect(positiveInt().parse(100)).toBe(100);
    });

    it('should reject zero and negatives', () => {
      expect(() => positiveInt().parse(0)).toThrow();
      expect(() => positiveInt().parse(-1)).toThrow();
    });

    it('should support min/max options', () => {
      const schema = positiveInt({ min: 5, max: 10 });
      expect(schema.parse(5)).toBe(5);
      expect(schema.parse(10)).toBe(10);
      expect(() => schema.parse(4)).toThrow();
      expect(() => schema.parse(11)).toThrow();
    });
  });

  describe('optionalPositiveInt', () => {
    it('should use default when undefined', () => {
      const schema = optionalPositiveInt(42);
      expect(schema.parse(undefined)).toBe(42);
    });

    it('should use default for empty string', () => {
      const schema = optionalPositiveInt(42);
      expect(schema.parse('')).toBe(42);
    });

    it('should use provided value', () => {
      const schema = optionalPositiveInt(42);
      expect(schema.parse('10')).toBe(10);
    });
  });

  describe('nonEmptyString', () => {
    it('should accept non-empty strings', () => {
      expect(nonEmptyString.parse('hello')).toBe('hello');
    });

    it('should reject empty strings', () => {
      expect(() => nonEmptyString.parse('')).toThrow();
    });
  });

  describe('isoDateString', () => {
    it('should accept valid ISO date strings', () => {
      expect(isoDateString.parse('2026-01-28T12:00:00.000Z')).toBeDefined();
    });

    it('should accept datetime with offset', () => {
      expect(isoDateString.parse('2026-01-28T12:00:00+05:00')).toBeDefined();
    });

    it('should reject invalid dates', () => {
      expect(() => isoDateString.parse('not-a-date')).toThrow();
    });
  });

  describe('optionalIsoDate', () => {
    it('should accept undefined', () => {
      expect(optionalIsoDate.parse(undefined)).toBeUndefined();
    });

    it('should accept valid date', () => {
      expect(optionalIsoDate.parse('2026-01-28T12:00:00.000Z')).toBeDefined();
    });
  });

  describe('filePathSchema', () => {
    it('should accept valid paths', () => {
      expect(filePathSchema.parse('src/index.ts')).toBe('src/index.ts');
    });

    it('should reject path traversal', () => {
      expect(() => filePathSchema.parse('../etc/passwd')).toThrow();
    });

    it('should reject absolute paths', () => {
      expect(() => filePathSchema.parse('/etc/passwd')).toThrow();
    });

    it('should reject empty paths', () => {
      expect(() => filePathSchema.parse('')).toThrow();
    });
  });

  describe('TelemetryEventTypeSchema', () => {
    it('should accept all valid types', () => {
      const validTypes = [
        'task.created',
        'task.status_changed',
        'task.archived',
        'task.restored',
        'run.started',
        'run.completed',
        'run.error',
        'run.tokens',
      ];
      for (const type of validTypes) {
        expect(TelemetryEventTypeSchema.parse(type)).toBe(type);
      }
    });

    it('should reject invalid types', () => {
      expect(() => TelemetryEventTypeSchema.parse('invalid.type')).toThrow();
    });
  });

  describe('MetricsPeriodSchema', () => {
    it('should accept valid periods', () => {
      expect(MetricsPeriodSchema.parse('24h')).toBe('24h');
      expect(MetricsPeriodSchema.parse('7d')).toBe('7d');
      expect(MetricsPeriodSchema.parse('30d')).toBe('30d');
    });

    it('should reject invalid periods', () => {
      expect(() => MetricsPeriodSchema.parse('1h')).toThrow();
    });
  });
});

describe('Conflict Schemas', () => {
  it('should validate conflict params', () => {
    const result = ConflictParamsSchema.parse({ taskId: 'task_20260128_abc123' });
    expect(result.taskId).toBe('task_20260128_abc123');
  });

  it('should validate conflict file query', () => {
    const result = ConflictFileQuerySchema.parse({ path: 'src/file.ts' });
    expect(result.path).toBe('src/file.ts');
  });

  it('should validate resolve conflict body with ours/theirs', () => {
    const result = ResolveConflictBodySchema.parse({ resolution: 'ours' });
    expect(result.resolution).toBe('ours');
  });

  it('should require manualContent for manual resolution', () => {
    expect(() => ResolveConflictBodySchema.parse({ resolution: 'manual' })).toThrow();
  });

  it('should accept manual resolution with content', () => {
    const result = ResolveConflictBodySchema.parse({
      resolution: 'manual',
      manualContent: 'merged content',
    });
    expect(result.manualContent).toBe('merged content');
  });

  it('should validate continue merge body', () => {
    expect(ContinueMergeBodySchema.parse({})).toBeDefined();
    expect(ContinueMergeBodySchema.parse({ message: 'Merge commit' }).message).toBe('Merge commit');
  });
});

describe('Diff Schemas', () => {
  it('should validate diff params', () => {
    const result = DiffParamsSchema.parse({ taskId: 'task_20260128_xyz789' });
    expect(result.taskId).toBe('task_20260128_xyz789');
  });

  it('should validate diff file query', () => {
    const result = DiffFileQuerySchema.parse({ path: 'README.md' });
    expect(result.path).toBe('README.md');
  });
});

describe('Feature Settings Schema', () => {
  it('should accept valid board settings', () => {
    const result = FeatureSettingsPatchSchema.parse({
      board: { showDashboard: true, cardDensity: 'compact' },
    });
    expect(result.board?.showDashboard).toBe(true);
  });

  it('should accept valid task behavior settings', () => {
    const result = FeatureSettingsPatchSchema.parse({
      tasks: { enableTimeTracking: true, defaultPriority: 'high' },
    });
    expect(result.tasks?.enableTimeTracking).toBe(true);
  });

  it('should accept valid agent behavior settings', () => {
    const result = FeatureSettingsPatchSchema.parse({
      agents: { timeoutMinutes: 30, autoCommitOnComplete: true },
    });
    expect(result.agents?.timeoutMinutes).toBe(30);
  });

  it('should accept product mode settings', () => {
    const result = FeatureSettingsPatchSchema.parse({
      productMode: {
        selectedMode: 'qa-review',
        lastSelectedAt: '2026-06-03T12:00:00.000Z',
        dismissedHints: ['workflow-panel'],
      },
    });
    expect(result.productMode?.selectedMode).toBe('qa-review');
  });

  it('should accept telemetry settings', () => {
    const result = FeatureSettingsPatchSchema.parse({
      telemetry: { enabled: true, retentionDays: 30 },
    });
    expect(result.telemetry?.enabled).toBe(true);
  });

  it('should accept notification settings', () => {
    const result = FeatureSettingsPatchSchema.parse({
      notifications: { enabled: true, onTaskComplete: true },
    });
    expect(result.notifications?.enabled).toBe(true);
  });

  it('should accept archive settings', () => {
    const result = FeatureSettingsPatchSchema.parse({
      archive: { autoArchiveEnabled: true, autoArchiveAfterDays: 30 },
    });
    expect(result.archive?.autoArchiveEnabled).toBe(true);
  });

  it('should accept budget settings', () => {
    const result = FeatureSettingsPatchSchema.parse({
      budget: { enabled: true, monthlyTokenLimit: 1000000 },
    });
    expect(result.budget?.enabled).toBe(true);
  });

  it('should reject unknown keys (strict mode)', () => {
    expect(() => FeatureSettingsPatchSchema.parse({ unknownSection: {} })).toThrow();
  });

  it('should reject dangerous keys (__proto__)', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => FeatureSettingsPatchSchema.parse(input)).toThrow();
  });

  it('should accept empty object', () => {
    const result = FeatureSettingsPatchSchema.parse({});
    expect(result).toBeDefined();
  });
});

describe('Metrics Schemas', () => {
  it('should validate metrics query with defaults', () => {
    const result = MetricsQuerySchema.parse({});
    expect(result.period).toBe('7d'); // Default changed from 24h to 7d in v2.1.0
  });

  it('should validate metrics query with project', () => {
    const result = MetricsQuerySchema.parse({ period: '7d', project: 'my-project' });
    expect(result.period).toBe('7d');
    expect(result.project).toBe('my-project');
  });

  it('should validate task metrics query', () => {
    const result = TaskMetricsQuerySchema.parse({ project: 'test' });
    expect(result.project).toBe('test');
  });

  it('should validate budget metrics query with defaults', () => {
    const result = BudgetMetricsQuerySchema.parse({});
    expect(result.tokenBudget).toBe(0);
    expect(result.costBudget).toBe(0);
    expect(result.warningThreshold).toBe(80);
  });

  it('should validate agent comparison query', () => {
    const result = AgentComparisonQuerySchema.parse({ period: '30d' });
    expect(result.period).toBe('30d');
    expect(result.minRuns).toBe(3);
  });

  it('should validate velocity query', () => {
    const result = VelocityQuerySchema.parse({ limit: '5' });
    expect(result.limit).toBe(5);
  });
});

describe('Preview Schemas', () => {
  it('should validate preview params', () => {
    const result = PreviewParamsSchema.parse({ taskId: 'task_20260128_abc123' });
    expect(result.taskId).toBe('task_20260128_abc123');
  });

  it('should validate preview output query with defaults', () => {
    const result = PreviewOutputQuerySchema.parse({});
    expect(result.lines).toBe(50);
  });

  it('should validate preview output query with custom lines', () => {
    const result = PreviewOutputQuerySchema.parse({ lines: '100' });
    expect(result.lines).toBe(100);
  });
});

describe('Telemetry Schemas', () => {
  it('should validate telemetry events query', () => {
    const result = TelemetryEventsQuerySchema.parse({
      taskId: 'task_20260128_abc123',
      limit: '50',
    });
    expect(result.limit).toBe(50);
  });

  it('should validate telemetry task params', () => {
    const result = TelemetryTaskParamsSchema.parse({ taskId: 'task_20260128_abc123' });
    expect(result.taskId).toBe('task_20260128_abc123');
  });

  it('should validate telemetry count query', () => {
    const result = TelemetryCountQuerySchema.parse({
      type: 'task.created,run.started',
    });
    expect(result.type).toEqual(['task.created', 'run.started']);
  });

  it('should reject invalid telemetry event types', () => {
    expect(() => TelemetryCountQuerySchema.parse({ type: 'invalid.type' })).toThrow();
  });

  it('should validate bulk query', () => {
    const result = TelemetryBulkQuerySchema.parse({
      taskIds: ['task_20260128_abc123', 'task_20260128_def456'],
    });
    expect(result.taskIds).toHaveLength(2);
  });

  it('should reject empty bulk taskIds', () => {
    expect(() => TelemetryBulkQuerySchema.parse({ taskIds: [] })).toThrow();
  });

  describe('TelemetryEventIngestionSchema', () => {
    it('should validate run.started event', () => {
      const result = TelemetryEventIngestionSchema.parse({
        type: 'run.started',
        taskId: 'task_123',
        agent: 'claude-code',
        model: 'opus',
      });
      expect(result.type).toBe('run.started');
    });

    it('should validate run.completed event', () => {
      const result = TelemetryEventIngestionSchema.parse({
        type: 'run.completed',
        taskId: 'task_123',
        agent: 'claude-code',
        success: true,
        durationMs: 5000,
      });
      expect(result.type).toBe('run.completed');
    });

    it('should validate run.error event', () => {
      const result = TelemetryEventIngestionSchema.parse({
        type: 'run.error',
        taskId: 'task_123',
        agent: 'amp',
        error: 'Timeout exceeded',
      });
      expect(result.type).toBe('run.error');
    });

    it('should validate run.tokens event', () => {
      const result = TelemetryEventIngestionSchema.parse({
        type: 'run.tokens',
        taskId: 'task_123',
        agent: 'claude-code',
        inputTokens: 1000,
        outputTokens: 500,
        cost: 0.05,
      });
      expect(result.type).toBe('run.tokens');
    });

    it('should reject unknown event type', () => {
      expect(() =>
        TelemetryEventIngestionSchema.parse({
          type: 'unknown.type',
          taskId: 'task_123',
        })
      ).toThrow();
    });
  });

  it('should validate export query with defaults', () => {
    const result = TelemetryExportQuerySchema.parse({});
    expect(result.format).toBe('json');
  });

  it('should validate export query with csv format', () => {
    const result = TelemetryExportQuerySchema.parse({ format: 'csv' });
    expect(result.format).toBe('csv');
  });
});

// ============ New Mutation Schemas ============

describe('Task Mutation Schemas', () => {
  describe('ReorderTasksBodySchema', () => {
    it('should accept valid orderedIds', () => {
      const result = ReorderTasksBodySchema.parse({ orderedIds: ['task_1', 'task_2'] });
      expect(result.orderedIds).toEqual(['task_1', 'task_2']);
    });

    it('should reject empty array', () => {
      expect(() => ReorderTasksBodySchema.parse({ orderedIds: [] })).toThrow();
    });

    it('should reject missing orderedIds', () => {
      expect(() => ReorderTasksBodySchema.parse({})).toThrow();
    });

    it('should reject non-array orderedIds', () => {
      expect(() => ReorderTasksBodySchema.parse({ orderedIds: 'not-an-array' })).toThrow();
    });
  });

  describe('ApplyTemplateBodySchema', () => {
    it('should accept valid template application', () => {
      const result = ApplyTemplateBodySchema.parse({
        templateId: 'tmpl_1',
        templateName: 'Bug Fix',
        fieldsChanged: ['type', 'priority'],
      });
      expect(result.templateId).toBe('tmpl_1');
      expect(result.templateName).toBe('Bug Fix');
    });

    it('should accept minimal input (templateId only)', () => {
      const result = ApplyTemplateBodySchema.parse({ templateId: 'tmpl_1' });
      expect(result.templateId).toBe('tmpl_1');
    });

    it('should reject missing templateId', () => {
      expect(() => ApplyTemplateBodySchema.parse({})).toThrow();
    });

    it('should reject empty templateId', () => {
      expect(() => ApplyTemplateBodySchema.parse({ templateId: '' })).toThrow();
    });
  });
});

describe('Time Schemas', () => {
  describe('AddTimeEntryBodySchema', () => {
    it('should accept valid time entry', () => {
      const result = AddTimeEntryBodySchema.parse({ duration: 3600, description: 'Work' });
      expect(result.duration).toBe(3600);
      expect(result.description).toBe('Work');
    });

    it('should accept entry without description', () => {
      const result = AddTimeEntryBodySchema.parse({ duration: 60 });
      expect(result.duration).toBe(60);
    });

    it('should reject zero duration', () => {
      expect(() => AddTimeEntryBodySchema.parse({ duration: 0 })).toThrow();
    });

    it('should reject negative duration', () => {
      expect(() => AddTimeEntryBodySchema.parse({ duration: -100 })).toThrow();
    });

    it('should reject missing duration', () => {
      expect(() => AddTimeEntryBodySchema.parse({})).toThrow();
    });

    it('should reject string duration', () => {
      expect(() => AddTimeEntryBodySchema.parse({ duration: '60' })).toThrow();
    });
  });
});

describe('Archive Schemas', () => {
  describe('BulkArchiveBodySchema', () => {
    it('should accept valid sprint', () => {
      const result = BulkArchiveBodySchema.parse({ sprint: 'Sprint 1' });
      expect(result.sprint).toBe('Sprint 1');
    });

    it('should reject empty sprint', () => {
      expect(() => BulkArchiveBodySchema.parse({ sprint: '' })).toThrow();
    });

    it('should reject missing sprint', () => {
      expect(() => BulkArchiveBodySchema.parse({})).toThrow();
    });
  });
});

describe('Config Schemas', () => {
  describe('SetDefaultAgentBodySchema', () => {
    it('should accept valid agent type', () => {
      const result = SetDefaultAgentBodySchema.parse({ agent: 'claude-code' });
      expect(result.agent).toBe('claude-code');
    });

    it('should accept all valid agent types', () => {
      const agents = ['claude-code', 'amp', 'copilot', 'gemini'];
      for (const agent of agents) {
        expect(SetDefaultAgentBodySchema.parse({ agent }).agent).toBe(agent);
      }
    });

    it('should accept custom agent types', () => {
      expect(SetDefaultAgentBodySchema.parse({ agent: 'my-custom-agent' }).agent).toBe(
        'my-custom-agent'
      );
    });

    it('should reject empty agent string', () => {
      expect(() => SetDefaultAgentBodySchema.parse({ agent: '' })).toThrow();
    });

    it('should reject missing agent', () => {
      expect(() => SetDefaultAgentBodySchema.parse({})).toThrow();
    });
  });

  describe('ValidateRepoPathBodySchema', () => {
    it('should accept valid path', () => {
      const result = ValidateRepoPathBodySchema.parse({ path: '/home/user/repo' });
      expect(result.path).toBe('/home/user/repo');
    });

    it('should reject empty path', () => {
      expect(() => ValidateRepoPathBodySchema.parse({ path: '' })).toThrow();
    });

    it('should reject missing path', () => {
      expect(() => ValidateRepoPathBodySchema.parse({})).toThrow();
    });
  });
});

describe('Agent Schemas', () => {
  describe('StartAgentBodySchema', () => {
    it('should accept with agent type', () => {
      const result = StartAgentBodySchema.parse({ agent: 'claude-code' });
      expect(result.agent).toBe('claude-code');
    });

    it('should accept without agent type', () => {
      const result = StartAgentBodySchema.parse({});
      expect(result.agent).toBeUndefined();
    });

    it('should accept custom agent types', () => {
      expect(StartAgentBodySchema.parse({ agent: 'my-custom-agent' }).agent).toBe(
        'my-custom-agent'
      );
    });

    it('should reject empty agent string', () => {
      expect(() => StartAgentBodySchema.parse({ agent: '' })).toThrow();
    });
  });

  describe('CompleteAgentBodySchema', () => {
    it('should accept successful completion', () => {
      const result = CompleteAgentBodySchema.parse({ success: true, summary: 'Done!' });
      expect(result.success).toBe(true);
      expect(result.summary).toBe('Done!');
    });

    it('should accept failed completion with error', () => {
      const result = CompleteAgentBodySchema.parse({ success: false, error: 'Timeout' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout');
    });

    it('should reject missing success field', () => {
      expect(() => CompleteAgentBodySchema.parse({})).toThrow();
    });

    it('should reject non-boolean success', () => {
      expect(() => CompleteAgentBodySchema.parse({ success: 'true' })).toThrow();
    });
  });

  describe('ReportTokensBodySchema', () => {
    it('should accept valid token report', () => {
      const result = ReportTokensBodySchema.parse({
        inputTokens: 1000,
        outputTokens: 500,
        model: 'claude-opus',
        agent: 'claude-code',
      });
      expect(result.inputTokens).toBe(1000);
      expect(result.outputTokens).toBe(500);
    });

    it('should accept minimal token report', () => {
      const result = ReportTokensBodySchema.parse({ inputTokens: 100, outputTokens: 50 });
      expect(result.inputTokens).toBe(100);
    });

    it('should reject missing inputTokens', () => {
      expect(() => ReportTokensBodySchema.parse({ outputTokens: 50 })).toThrow();
    });

    it('should reject missing outputTokens', () => {
      expect(() => ReportTokensBodySchema.parse({ inputTokens: 100 })).toThrow();
    });

    it('should reject negative tokens', () => {
      expect(() => ReportTokensBodySchema.parse({ inputTokens: -1, outputTokens: 50 })).toThrow();
    });
  });
});

describe('Auth Schemas', () => {
  describe('AuthSetupBodySchema', () => {
    it('should accept valid password', () => {
      const result = AuthSetupBodySchema.parse({ password: 'securepassword' });
      expect(result.password).toBe('securepassword');
    });

    it('should reject short password', () => {
      expect(() => AuthSetupBodySchema.parse({ password: 'short' })).toThrow();
    });

    it('should reject empty password', () => {
      expect(() => AuthSetupBodySchema.parse({ password: '' })).toThrow();
    });

    it('should reject missing password', () => {
      expect(() => AuthSetupBodySchema.parse({})).toThrow();
    });
  });

  describe('AuthLoginBodySchema', () => {
    it('should accept valid login', () => {
      const result = AuthLoginBodySchema.parse({ password: 'mypassword' });
      expect(result.password).toBe('mypassword');
    });

    it('should accept login with rememberMe', () => {
      const result = AuthLoginBodySchema.parse({ password: 'mypassword', rememberMe: true });
      expect(result.rememberMe).toBe(true);
    });

    it('should reject empty password', () => {
      expect(() => AuthLoginBodySchema.parse({ password: '' })).toThrow();
    });

    it('should reject missing password', () => {
      expect(() => AuthLoginBodySchema.parse({})).toThrow();
    });
  });

  describe('AuthRecoverBodySchema', () => {
    it('should accept valid recovery', () => {
      const result = AuthRecoverBodySchema.parse({
        recoveryKey: 'my-recovery-key',
        newPassword: 'newpassword123',
      });
      expect(result.recoveryKey).toBe('my-recovery-key');
      expect(result.newPassword).toBe('newpassword123');
    });

    it('should reject short new password', () => {
      expect(() =>
        AuthRecoverBodySchema.parse({
          recoveryKey: 'key',
          newPassword: 'short',
        })
      ).toThrow();
    });

    it('should reject missing recovery key', () => {
      expect(() => AuthRecoverBodySchema.parse({ newPassword: 'newpassword123' })).toThrow();
    });

    it('should reject missing new password', () => {
      expect(() => AuthRecoverBodySchema.parse({ recoveryKey: 'key' })).toThrow();
    });
  });

  describe('AuthChangePasswordBodySchema', () => {
    it('should accept valid password change', () => {
      const result = AuthChangePasswordBodySchema.parse({
        currentPassword: 'oldpass',
        newPassword: 'newpassword123',
      });
      expect(result.currentPassword).toBe('oldpass');
      expect(result.newPassword).toBe('newpassword123');
    });

    it('should reject short new password', () => {
      expect(() =>
        AuthChangePasswordBodySchema.parse({
          currentPassword: 'oldpass',
          newPassword: 'short',
        })
      ).toThrow();
    });
  });

  describe('AuthRotateSecretBodySchema', () => {
    it('should accept empty body', () => {
      const result = AuthRotateSecretBodySchema.parse({});
      expect(result).toBeDefined();
    });

    it('should accept undefined body', () => {
      const result = AuthRotateSecretBodySchema.parse(undefined);
      expect(result).toBeDefined();
    });

    it('should accept valid grace period', () => {
      const result = AuthRotateSecretBodySchema.parse({ gracePeriodDays: 14 });
      expect(result.gracePeriodDays).toBe(14);
    });

    it('should reject grace period > 90', () => {
      expect(() => AuthRotateSecretBodySchema.parse({ gracePeriodDays: 100 })).toThrow();
    });

    it('should reject negative grace period', () => {
      expect(() => AuthRotateSecretBodySchema.parse({ gracePeriodDays: -1 })).toThrow();
    });
  });
});
