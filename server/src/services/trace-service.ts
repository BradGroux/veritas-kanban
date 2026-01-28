import fs from 'fs/promises';
import path from 'path';
import type { AgentType } from '@veritas-kanban/shared';
import { getTelemetryService } from './telemetry-service.js';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const TRACES_DIR = path.join(PROJECT_ROOT, '.veritas-kanban', 'traces');

export type TraceStepType = 'init' | 'execute' | 'complete' | 'error';

export interface TraceStep {
  type: TraceStepType;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface Trace {
  traceId: string; // Same as attemptId
  taskId: string;
  agent: AgentType;
  project?: string;
  startedAt: string;
  endedAt?: string;
  totalDurationMs?: number;
  steps: TraceStep[];
  status: 'running' | 'completed' | 'failed' | 'error';
}

// In-memory store for active traces
const activeTraces = new Map<string, Trace>();

export class TraceService {
  private tracesDir: string;
  private enabled: boolean = false;

  constructor() {
    this.tracesDir = TRACES_DIR;
    this.init();
  }

  private async init(): Promise<void> {
    // Check if traces are enabled in telemetry config
    const telemetry = getTelemetryService();
    const config = telemetry.getConfig();
    this.enabled = config.traces ?? false;

    if (this.enabled) {
      await fs.mkdir(this.tracesDir, { recursive: true });
    }
  }

  /**
   * Check if tracing is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable tracing
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      // Intentionally silent: best-effort directory creation
      fs.mkdir(this.tracesDir, { recursive: true }).catch(() => {});
    }
  }

  /**
   * Start a new trace for an agent run
   */
  startTrace(attemptId: string, taskId: string, agent: AgentType, project?: string): Trace | null {
    if (!this.enabled) return null;

    const trace: Trace = {
      traceId: attemptId,
      taskId,
      agent,
      project,
      startedAt: new Date().toISOString(),
      steps: [],
      status: 'running',
    };

    activeTraces.set(attemptId, trace);
    return trace;
  }

  /**
   * Start a step within a trace
   */
  startStep(
    attemptId: string,
    stepType: TraceStepType,
    metadata?: Record<string, unknown>
  ): TraceStep | null {
    if (!this.enabled) return null;

    const trace = activeTraces.get(attemptId);
    if (!trace) return null;

    const step: TraceStep = {
      type: stepType,
      startedAt: new Date().toISOString(),
      metadata,
    };

    trace.steps.push(step);
    return step;
  }

  /**
   * End the current step of a given type
   */
  endStep(attemptId: string, stepType: TraceStepType): void {
    if (!this.enabled) return;

    const trace = activeTraces.get(attemptId);
    if (!trace) return;

    // Find the last step of this type that hasn't ended
    const step = [...trace.steps].reverse().find((s) => s.type === stepType && !s.endedAt);

    if (step) {
      step.endedAt = new Date().toISOString();
      step.durationMs = new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime();
    }
  }

  /**
   * Complete a trace (success or failure)
   */
  async completeTrace(
    attemptId: string,
    status: 'completed' | 'failed' | 'error'
  ): Promise<Trace | null> {
    if (!this.enabled) return null;

    const trace = activeTraces.get(attemptId);
    if (!trace) return null;

    trace.endedAt = new Date().toISOString();
    trace.totalDurationMs = new Date(trace.endedAt).getTime() - new Date(trace.startedAt).getTime();
    trace.status = status;

    // Close any open steps
    for (const step of trace.steps) {
      if (!step.endedAt) {
        step.endedAt = trace.endedAt;
        step.durationMs = new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime();
      }
    }

    // Save to disk
    await this.saveTrace(trace);

    // Remove from active traces
    activeTraces.delete(attemptId);

    return trace;
  }

  /**
   * Get an active trace
   */
  getActiveTrace(attemptId: string): Trace | null {
    return activeTraces.get(attemptId) || null;
  }

  /**
   * Get a completed trace from disk
   */
  async getTrace(attemptId: string): Promise<Trace | null> {
    // Check active traces first
    const active = activeTraces.get(attemptId);
    if (active) return active;

    // Try to load from disk
    try {
      const filepath = path.join(this.tracesDir, `${attemptId}.json`);
      const content = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(content) as Trace;
    } catch {
      // Intentionally silent: trace file may not exist on disk
      return null;
    }
  }

  /**
   * List all traces for a task
   */
  async listTraces(taskId: string): Promise<Trace[]> {
    const traces: Trace[] = [];

    // Add active traces for this task
    for (const trace of activeTraces.values()) {
      if (trace.taskId === taskId) {
        traces.push(trace);
      }
    }

    // Load completed traces from disk
    try {
      const files = await fs.readdir(this.tracesDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = await fs.readFile(path.join(this.tracesDir, file), 'utf-8');
          const trace = JSON.parse(content) as Trace;
          if (trace.taskId === taskId && !activeTraces.has(trace.traceId)) {
            traces.push(trace);
          }
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory might not exist
    }

    // Sort by startedAt descending
    return traces.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /**
   * Save a trace to disk
   */
  private async saveTrace(trace: Trace): Promise<void> {
    await fs.mkdir(this.tracesDir, { recursive: true });
    const filepath = path.join(this.tracesDir, `${trace.traceId}.json`);
    await fs.writeFile(filepath, JSON.stringify(trace, null, 2), 'utf-8');
  }
}

// Singleton instance
let instance: TraceService | null = null;

export function getTraceService(): TraceService {
  if (!instance) {
    instance = new TraceService();
  }
  return instance;
}
