/**
 * System Health Types
 *
 * Shared types for the Global System Health Status Bar feature.
 * These types are used by both the server (health aggregation) and
 * the web client (status bar component and polling hook).
 */

// ─── Health Level / Status ─────────────────────────────────────

/**
 * The five possible health levels, in ascending order of severity.
 *
 * - stable   : All metrics within normal ranges
 * - reviewing: Minor signals detected
 * - drifting : Behavioral drift detected
 * - elevated : Multiple warnings active
 * - alert    : Critical issues requiring attention
 */
export type HealthLevel = 'stable' | 'reviewing' | 'drifting' | 'elevated' | 'alert';

// Keep OverallStatus as an alias for backwards-compatibility with the
// inline types that already exist in the server route.
export type OverallStatus = HealthLevel;

// ─── Individual Signals ────────────────────────────────────────

/** Infrastructure / system-level signal */
export interface SystemSignal {
  status: 'ok' | 'warn' | 'fail';
  storage: boolean;
  disk: boolean;
  memory: boolean;
}

/** Agent registry signal */
export interface AgentSignal {
  status: 'ok' | 'warn' | 'critical';
  total: number;
  online: number;
  offline: number;
}

/** Recent task/run operations signal */
export interface OperationsSignal {
  status: 'ok' | 'warn' | 'critical';
  recentRuns: number;
  /** Success rate as a percentage (0–100) */
  successRate: number;
  failedRuns: number;
}

// ─── Composite Signal ──────────────────────────────────────────

/**
 * A single named health signal.
 * The `signals` map in `HealthStatus` uses this as its value type
 * so consumers can iterate over signals generically.
 */
export interface HealthSignal {
  /** Signal severity */
  status: 'ok' | 'warn' | 'fail' | 'critical';
  /** Human-readable label for the signal category */
  label: string;
  /** Optional detail pairs shown in the expanded detail panel */
  details?: Record<string, string | number | boolean>;
}

// ─── Top-level Response ────────────────────────────────────────

/**
 * The full health status response returned by `GET /api/v1/system/health`.
 */
export interface HealthStatus {
  /** ISO-8601 timestamp of when the check ran */
  timestamp: string;
  /** Aggregated health level */
  status: HealthLevel;
  /** Per-category signal breakdown */
  signals: {
    system: SystemSignal;
    agents: AgentSignal;
    operations: OperationsSignal;
  };
}
