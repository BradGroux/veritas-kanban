/**
 * Transition Hooks Types
 *
 * Quality gates and actions that fire on task status transitions.
 * Pre-hooks (gates) must pass before status change is allowed.
 * Post-hooks (actions) fire after status change succeeds.
 */

import type { TaskStatus } from './task.types.js';

// ---------------------------------------------------------------------------
// Gate Types (Pre-transition checks)
// ---------------------------------------------------------------------------

/**
 * Types of pre-transition gates that can block a status change.
 */
export type GateType =
  | 'require-agent' // Task must have an agent assigned
  | 'require-plan' // Task description must contain a plan section
  | 'require-verification-complete' // All verification steps must be checked
  | 'require-time-tracked' // Time tracking must have entries
  | 'require-closing-comment' // Task must have at least one comment
  | 'require-subtasks-complete' // All subtasks must be completed
  | 'require-blocker-reason'; // blockedReason must be set (for blocked status)

/**
 * A pre-transition gate configuration.
 */
export interface TransitionGate {
  /** Unique identifier for this gate */
  id: string;
  /** Human-readable name */
  name: string;
  /** Type of check to perform */
  type: GateType;
  /** Whether this gate is currently enabled */
  enabled: boolean;
  /** Optional: only apply to specific projects */
  projects?: string[];
  /** Optional: only apply to specific task types */
  taskTypes?: string[];
  /** Custom error message when gate fails */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Action Types (Post-transition effects)
// ---------------------------------------------------------------------------

/**
 * Types of post-transition actions that fire after status change.
 */
export type ActionType =
  | 'auto-start-timer' // Start time tracking
  | 'auto-stop-timer' // Stop time tracking
  | 'send-webhook' // POST to a URL
  | 'send-notification' // Send notification to channel
  | 'prompt-lessons-learned' // Flag task for lessons learned capture
  | 'log-activity'; // Log to activity feed

/**
 * A post-transition action configuration.
 */
export interface TransitionAction {
  /** Unique identifier for this action */
  id: string;
  /** Human-readable name */
  name: string;
  /** Type of action to perform */
  type: ActionType;
  /** Whether this action is currently enabled */
  enabled: boolean;
  /** Optional: only apply to specific projects */
  projects?: string[];
  /** Optional: only apply to specific task types */
  taskTypes?: string[];
  /** Configuration for webhook actions */
  webhookUrl?: string;
  /** Configuration for notification actions */
  notificationChannel?: string;
}

// ---------------------------------------------------------------------------
// Transition Rule
// ---------------------------------------------------------------------------

/**
 * A complete transition rule combining source/target states with gates and actions.
 */
export interface TransitionRule {
  /** Unique identifier for this rule */
  id: string;
  /** Human-readable name */
  name: string;
  /** Whether this rule is currently enabled */
  enabled: boolean;
  /**
   * Source status(es) - use '*' for any status.
   * Can be a single status or array of statuses.
   */
  from: TaskStatus | TaskStatus[] | '*';
  /**
   * Target status(es) - use '*' for any status.
   * Can be a single status or array of statuses.
   */
  to: TaskStatus | TaskStatus[] | '*';
  /** Pre-transition gates that must pass */
  gates: TransitionGate[];
  /** Post-transition actions to execute */
  actions: TransitionAction[];
  /** Optional: only apply to specific projects */
  projects?: string[];
  /** Optional: only apply to specific task types */
  taskTypes?: string[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Complete transition hooks configuration.
 */
export interface TransitionHooksConfig {
  /** Global enable/disable for transition hooks */
  enabled: boolean;
  /** List of transition rules */
  rules: TransitionRule[];
  /** Default gates applied to all transitions (can be overridden per-rule) */
  defaultGates?: TransitionGate[];
  /** Default actions applied to all transitions (can be overridden per-rule) */
  defaultActions?: TransitionAction[];
}

// ---------------------------------------------------------------------------
// Validation Results
// ---------------------------------------------------------------------------

/**
 * Result of a single gate check.
 */
export interface GateCheckResult {
  gate: TransitionGate;
  passed: boolean;
  message?: string;
}

/**
 * Result of validating all gates for a transition.
 */
export interface TransitionValidationResult {
  /** Whether all gates passed */
  allowed: boolean;
  /** Individual gate results */
  gateResults: GateCheckResult[];
  /** Summary of failed gates (if any) */
  failedGates: GateCheckResult[];
  /** Human-readable error message if not allowed */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

/**
 * Default transition hooks configuration with common quality gates.
 */
export const DEFAULT_TRANSITION_HOOKS_CONFIG: TransitionHooksConfig = {
  enabled: false,
  rules: [
    {
      id: 'rule-start-work',
      name: 'Start Work',
      enabled: true,
      from: 'todo',
      to: 'in-progress',
      gates: [],
      actions: [
        {
          id: 'action-auto-start-timer',
          name: 'Auto-start timer',
          type: 'auto-start-timer',
          enabled: true,
        },
      ],
    },
    {
      id: 'rule-complete-work',
      name: 'Complete Work',
      enabled: true,
      from: ['todo', 'in-progress', 'blocked'],
      to: 'done',
      gates: [
        {
          id: 'gate-verification-complete',
          name: 'Verification steps complete',
          type: 'require-verification-complete',
          enabled: false, // Disabled by default
          errorMessage: 'All verification steps must be checked before completing',
        },
        {
          id: 'gate-time-tracked',
          name: 'Time tracked',
          type: 'require-time-tracked',
          enabled: false, // Disabled by default
          errorMessage: 'Time must be tracked before completing',
        },
      ],
      actions: [
        {
          id: 'action-auto-stop-timer',
          name: 'Auto-stop timer',
          type: 'auto-stop-timer',
          enabled: true,
        },
        {
          id: 'action-prompt-lessons',
          name: 'Prompt for lessons learned',
          type: 'prompt-lessons-learned',
          enabled: false, // Disabled by default
        },
      ],
    },
    {
      id: 'rule-block-work',
      name: 'Block Work',
      enabled: true,
      from: '*',
      to: 'blocked',
      gates: [
        {
          id: 'gate-blocker-reason',
          name: 'Blocker reason required',
          type: 'require-blocker-reason',
          enabled: false, // Disabled by default
          errorMessage: 'A blocker reason must be provided',
        },
      ],
      actions: [],
    },
  ],
};
