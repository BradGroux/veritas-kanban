/**
 * Circuit Breaker Pattern
 *
 * Prevents cascading failures when external services are unavailable.
 *
 * States:
 *   - Closed (normal): requests pass through, failures are tracked
 *   - Open (tripped): requests immediately rejected with CircuitOpenError
 *   - Half-open (testing): one request allowed through to test recovery
 */

import { createLogger } from '../lib/logger.js';

const log = createLogger('circuit-breaker');

// ============================================
// Types
// ============================================

export interface CircuitBreakerOptions {
  /** Name for logging and registry lookup */
  name: string;
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Ms before attempting recovery from open state (default: 30000) */
  resetTimeout?: number;
  /** Sliding window in ms for counting failures (default: 60000) */
  monitorWindow?: number;
}

export interface CircuitStatus {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: string | null;
  nextAttempt: string | null;
}

// ============================================
// Errors
// ============================================

export class CircuitOpenError extends Error {
  public readonly circuitName: string;
  public readonly nextAttempt: Date;

  constructor(name: string, nextAttempt: Date) {
    const nextAttemptStr = nextAttempt.toISOString();
    super(`Circuit "${name}" is open. Next attempt at ${nextAttemptStr}`);
    this.name = 'CircuitOpenError';
    this.circuitName = name;
    this.nextAttempt = nextAttempt;
  }
}

// ============================================
// Circuit Breaker
// ============================================

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly monitorWindow: number;

  private _state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureTimestamps: number[] = [];
  private lastFailureTime: number | null = null;
  private openedAt: number | null = null;
  private halfOpenInFlight = false;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30_000;
    this.monitorWindow = options.monitorWindow ?? 60_000;
  }

  /** Current circuit state */
  get state(): 'closed' | 'open' | 'half-open' {
    // If open and reset timeout has elapsed, transition to half-open
    if (this._state === 'open' && this.openedAt !== null) {
      if (Date.now() - this.openedAt >= this.resetTimeout) {
        this.transitionTo('half-open');
      }
    }
    return this._state;
  }

  /**
   * Execute a function through the circuit breaker.
   * In closed state: calls pass through; failures are tracked.
   * In open state: immediately throws CircuitOpenError.
   * In half-open state: allows one test request through.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state; // triggers lazy half-open check

    if (currentState === 'open') {
      throw new CircuitOpenError(
        this.name,
        new Date((this.openedAt ?? Date.now()) + this.resetTimeout)
      );
    }

    if (currentState === 'half-open') {
      // Only one request allowed in half-open
      if (this.halfOpenInFlight) {
        throw new CircuitOpenError(
          this.name,
          new Date((this.openedAt ?? Date.now()) + this.resetTimeout)
        );
      }
      this.halfOpenInFlight = true;
    }

    try {
      const result = await fn();

      // Success
      if (currentState === 'half-open') {
        this.halfOpenInFlight = false;
        this.transitionTo('closed');
      }

      return result;
    } catch (error) {
      this.recordFailure();

      if (currentState === 'half-open') {
        this.halfOpenInFlight = false;
        this.transitionTo('open');
      } else if (this.recentFailureCount() >= this.failureThreshold) {
        this.transitionTo('open');
      }

      throw error;
    }
  }

  /** Get current status for monitoring / health checks */
  getStatus(): CircuitStatus {
    const currentState = this.state; // triggers lazy half-open check
    return {
      state: currentState,
      failures: this.recentFailureCount(),
      lastFailure: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      nextAttempt:
        this._state === 'open' && this.openedAt !== null
          ? new Date(this.openedAt + this.resetTimeout).toISOString()
          : null,
    };
  }

  /** Manually reset the circuit to closed state */
  reset(): void {
    this.failureTimestamps = [];
    this.lastFailureTime = null;
    this.openedAt = null;
    this.halfOpenInFlight = false;
    this.transitionTo('closed');
  }

  // ----------------------------------------
  // Private helpers
  // ----------------------------------------

  private recordFailure(): void {
    const now = Date.now();
    this.failureTimestamps.push(now);
    this.lastFailureTime = now;
    this.pruneOldFailures();
  }

  /** Count failures within the sliding window */
  private recentFailureCount(): number {
    this.pruneOldFailures();
    return this.failureTimestamps.length;
  }

  /** Remove failures outside the monitor window */
  private pruneOldFailures(): void {
    const cutoff = Date.now() - this.monitorWindow;
    this.failureTimestamps = this.failureTimestamps.filter((t) => t > cutoff);
  }

  private transitionTo(newState: 'closed' | 'open' | 'half-open'): void {
    if (this._state === newState) return;

    const oldState = this._state;
    this._state = newState;

    if (newState === 'open') {
      this.openedAt = Date.now();
    } else if (newState === 'closed') {
      this.failureTimestamps = [];
      this.openedAt = null;
    }

    log.warn(
      { circuit: this.name, from: oldState, to: newState },
      `Circuit "${this.name}" transitioned: ${oldState} → ${newState}`
    );
  }
}
