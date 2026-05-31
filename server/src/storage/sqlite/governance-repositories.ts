import type { SQLInputValue } from 'node:sqlite';
import type {
  DecisionListFilters,
  DecisionRecord,
  DriftAlert,
  DriftBaseline,
  DriftMetric,
  DriftSeverity,
  EvaluationHistoryQuery,
  EvaluationResult,
  Feedback,
  FeedbackQuery,
  ScoringProfile,
} from '@veritas-kanban/shared';
import type { SqliteDatabase } from './database.js';

interface DecisionRow {
  decision_json: string;
}

interface FeedbackRow {
  feedback_json: string;
}

interface ScoringProfileRow {
  profile_json: string;
}

interface EvaluationRow {
  evaluation_json: string;
}

interface DriftAlertRow {
  payload_json: string;
}

interface DriftBaselineRow {
  payload_json: string;
}

export class SqliteDecisionRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async save(decision: DecisionRecord): Promise<void> {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO decision_records (
            id,
            workspace_id,
            agent_id,
            task_id,
            parent_decision_id,
            confidence_level,
            risk_score,
            decision_json,
            created_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            agent_id = excluded.agent_id,
            task_id = excluded.task_id,
            parent_decision_id = excluded.parent_decision_id,
            confidence_level = excluded.confidence_level,
            risk_score = excluded.risk_score,
            decision_json = excluded.decision_json,
            created_at = excluded.created_at
        `
      )
      .run(
        decision.id,
        decision.agentId ?? null,
        decision.taskId ?? null,
        decision.parentDecisionId ?? null,
        decision.confidenceLevel,
        decision.riskScore,
        JSON.stringify(decision),
        decision.timestamp
      );
  }

  async getById(id: string): Promise<DecisionRecord | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT decision_json
          FROM decision_records
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .get(id) as DecisionRow | undefined;

    return row ? (JSON.parse(row.decision_json) as DecisionRecord) : null;
  }

  async list(filters: DecisionListFilters = {}): Promise<DecisionRecord[]> {
    const clauses = ["workspace_id = 'local'"];
    const params: SQLInputValue[] = [];

    if (filters.agent) {
      clauses.push('agent_id = ?');
      params.push(filters.agent);
    }
    if (filters.startTime) {
      clauses.push('created_at >= ?');
      params.push(filters.startTime);
    }
    if (filters.endTime) {
      clauses.push('created_at <= ?');
      params.push(filters.endTime);
    }
    if (filters.minConfidence !== undefined) {
      clauses.push('confidence_level >= ?');
      params.push(filters.minConfidence);
    }
    if (filters.maxConfidence !== undefined) {
      clauses.push('confidence_level <= ?');
      params.push(filters.maxConfidence);
    }
    if (filters.minRisk !== undefined) {
      clauses.push('risk_score >= ?');
      params.push(filters.minRisk);
    }
    if (filters.maxRisk !== undefined) {
      clauses.push('risk_score <= ?');
      params.push(filters.maxRisk);
    }

    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT decision_json
          FROM decision_records
          WHERE ${clauses.join(' AND ')}
          ORDER BY datetime(created_at) DESC, id DESC
        `
      )
      .all(...params) as unknown as DecisionRow[];

    return rows.map((row) => JSON.parse(row.decision_json) as DecisionRecord);
  }
}

export class SqliteFeedbackRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async list(query: FeedbackQuery = {}): Promise<Feedback[]> {
    const clauses = ["workspace_id = 'local'"];
    const params: SQLInputValue[] = [];

    if (query.taskId) {
      clauses.push('task_id = ?');
      params.push(query.taskId);
    }
    if (query.agent) {
      clauses.push('agent = ?');
      params.push(query.agent);
    }
    if (query.sentiment) {
      clauses.push('sentiment = ?');
      params.push(query.sentiment);
    }
    if (query.resolved !== undefined) {
      clauses.push('resolved = ?');
      params.push(query.resolved ? 1 : 0);
    }
    if (query.since) {
      clauses.push('created_at >= ?');
      params.push(query.since);
    }
    if (query.until) {
      clauses.push('created_at <= ?');
      params.push(query.until);
    }

    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT feedback_json
          FROM feedback_records
          WHERE ${clauses.join(' AND ')}
          ORDER BY datetime(created_at) DESC, id DESC
        `
      )
      .all(...params) as unknown as FeedbackRow[];

    const limit = query.limit ?? 500;
    return rows
      .map((row) => JSON.parse(row.feedback_json) as Feedback)
      .filter((item) => !query.category || item.categories.includes(query.category))
      .slice(0, limit);
  }

  async get(id: string): Promise<Feedback | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT feedback_json
          FROM feedback_records
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .get(id) as FeedbackRow | undefined;

    return row ? (JSON.parse(row.feedback_json) as Feedback) : null;
  }

  async save(feedback: Feedback): Promise<void> {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO feedback_records (
            id,
            workspace_id,
            task_id,
            agent,
            rating,
            sentiment,
            resolved,
            categories_json,
            feedback_json,
            created_at,
            updated_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            task_id = excluded.task_id,
            agent = excluded.agent,
            rating = excluded.rating,
            sentiment = excluded.sentiment,
            resolved = excluded.resolved,
            categories_json = excluded.categories_json,
            feedback_json = excluded.feedback_json,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        feedback.id,
        feedback.taskId,
        feedback.agent ?? null,
        feedback.rating,
        feedback.sentiment,
        feedback.resolved ? 1 : 0,
        JSON.stringify(feedback.categories),
        JSON.stringify(feedback),
        feedback.createdAt,
        feedback.updatedAt
      );
  }

  async delete(id: string): Promise<boolean> {
    const result = this.database
      .getConnection()
      .prepare(
        `
          DELETE FROM feedback_records
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .run(id);

    return result.changes > 0;
  }
}

export class SqliteScoringRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async listProfiles(): Promise<ScoringProfile[]> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT profile_json
          FROM scoring_profiles
          WHERE workspace_id = 'local'
          ORDER BY built_in DESC, name ASC
        `
      )
      .all() as unknown as ScoringProfileRow[];

    return rows.map((row) => JSON.parse(row.profile_json) as ScoringProfile);
  }

  async getProfile(id: string): Promise<ScoringProfile | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT profile_json
          FROM scoring_profiles
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .get(id) as ScoringProfileRow | undefined;

    return row ? (JSON.parse(row.profile_json) as ScoringProfile) : null;
  }

  async saveProfile(profile: ScoringProfile): Promise<void> {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO scoring_profiles (
            id,
            workspace_id,
            name,
            built_in,
            profile_json,
            created_at,
            updated_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            built_in = excluded.built_in,
            profile_json = excluded.profile_json,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        profile.id,
        profile.name,
        profile.builtIn ? 1 : 0,
        JSON.stringify(profile),
        profile.created,
        profile.updated
      );
  }

  async deleteProfile(id: string): Promise<boolean> {
    const result = this.database
      .getConnection()
      .prepare(
        `
          DELETE FROM scoring_profiles
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .run(id);

    return result.changes > 0;
  }

  async saveEvaluation(result: EvaluationResult): Promise<void> {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO scoring_evaluations (
            id,
            workspace_id,
            profile_id,
            agent,
            task_id,
            composite_score,
            evaluation_json,
            created_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        result.id,
        result.profileId,
        result.agent ?? null,
        result.taskId ?? null,
        result.compositeScore,
        JSON.stringify(result),
        result.created
      );
  }

  async getHistory(query: EvaluationHistoryQuery = {}): Promise<EvaluationResult[]> {
    const clauses = ["workspace_id = 'local'"];
    const params: SQLInputValue[] = [];

    if (query.profileId) {
      clauses.push('profile_id = ?');
      params.push(query.profileId);
    }
    if (query.agent) {
      clauses.push('agent = ?');
      params.push(query.agent);
    }
    if (query.taskId) {
      clauses.push('task_id = ?');
      params.push(query.taskId);
    }

    const effectiveLimit = Math.min(Math.max(query.limit ?? 200, 1), 10_000);
    params.push(effectiveLimit);

    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT evaluation_json
          FROM scoring_evaluations
          WHERE ${clauses.join(' AND ')}
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT ?
        `
      )
      .all(...params) as unknown as EvaluationRow[];

    return rows.map((row) => JSON.parse(row.evaluation_json) as EvaluationResult);
  }
}

export class SqliteDriftRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async listAlerts(
    filters: {
      agentId?: string;
      metric?: DriftMetric;
      severity?: DriftSeverity;
      acknowledged?: boolean;
    } = {}
  ): Promise<DriftAlert[]> {
    const clauses = ["workspace_id = 'local'"];
    const params: SQLInputValue[] = [];

    if (filters.agentId) {
      clauses.push('agent_id = ?');
      params.push(filters.agentId);
    }
    if (filters.metric) {
      clauses.push('metric = ?');
      params.push(filters.metric);
    }
    if (filters.severity) {
      clauses.push('severity = ?');
      params.push(filters.severity);
    }
    if (filters.acknowledged !== undefined) {
      clauses.push('acknowledged = ?');
      params.push(filters.acknowledged ? 1 : 0);
    }

    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT payload_json
          FROM drift_alerts
          WHERE ${clauses.join(' AND ')}
          ORDER BY datetime(created_at) DESC, id DESC
        `
      )
      .all(...params) as unknown as DriftAlertRow[];

    return rows.map((row) => JSON.parse(row.payload_json) as DriftAlert);
  }

  async getAlert(id: string): Promise<DriftAlert | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT payload_json
          FROM drift_alerts
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .get(id) as DriftAlertRow | undefined;

    return row ? (JSON.parse(row.payload_json) as DriftAlert) : null;
  }

  async saveAlert(alert: DriftAlert): Promise<void> {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO drift_alerts (
            id,
            workspace_id,
            agent_id,
            metric,
            severity,
            acknowledged,
            payload_json,
            created_at,
            updated_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            agent_id = excluded.agent_id,
            metric = excluded.metric,
            severity = excluded.severity,
            acknowledged = excluded.acknowledged,
            payload_json = excluded.payload_json,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        alert.id,
        alert.agentId,
        alert.metric,
        alert.severity,
        alert.acknowledged ? 1 : 0,
        JSON.stringify(alert),
        alert.timestamp,
        new Date().toISOString()
      );
  }

  async listBaselines(
    filters: { agentId?: string; metric?: DriftMetric } = {}
  ): Promise<DriftBaseline[]> {
    const clauses = ["workspace_id = 'local'"];
    const params: SQLInputValue[] = [];

    if (filters.agentId) {
      clauses.push('agent_id = ?');
      params.push(filters.agentId);
    }
    if (filters.metric) {
      clauses.push('metric = ?');
      params.push(filters.metric);
    }

    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT payload_json
          FROM drift_baselines
          WHERE ${clauses.join(' AND ')}
          ORDER BY agent_id ASC, metric ASC
        `
      )
      .all(...params) as unknown as DriftBaselineRow[];

    return rows.map((row) => JSON.parse(row.payload_json) as DriftBaseline);
  }

  async saveBaseline(baseline: DriftBaseline): Promise<void> {
    const id = this.baselineId(baseline.agentId, baseline.metric);
    const now = new Date().toISOString();
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO drift_baselines (
            id,
            workspace_id,
            agent_id,
            metric,
            payload_json,
            created_at,
            updated_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id, agent_id, metric) DO UPDATE SET
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `
      )
      .run(
        id,
        baseline.agentId,
        baseline.metric,
        JSON.stringify(baseline),
        baseline.windowStart,
        now
      );
  }

  async resetBaselines(agentId: string, metric?: DriftMetric): Promise<{ deleted: number }> {
    const clauses = ["workspace_id = 'local'", 'agent_id = ?'];
    const params: SQLInputValue[] = [agentId];

    if (metric) {
      clauses.push('metric = ?');
      params.push(metric);
    }

    const result = this.database
      .getConnection()
      .prepare(
        `
          DELETE FROM drift_baselines
          WHERE ${clauses.join(' AND ')}
        `
      )
      .run(...params);

    return { deleted: Number(result.changes) };
  }

  private baselineId(agentId: string, metric: DriftMetric): string {
    return `${agentId}__${metric}`;
  }
}
