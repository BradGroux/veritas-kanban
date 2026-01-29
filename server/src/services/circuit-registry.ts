/**
 * Circuit Breaker Registry
 *
 * Centralized registry for all circuit breakers.
 * Pre-registers breakers for known external services.
 */

import {
  CircuitBreaker,
  type CircuitBreakerOptions,
  type CircuitStatus,
} from './circuit-breaker.js';

// ============================================
// Registry
// ============================================

const breakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker by name.
 * If the breaker already exists, the existing instance is returned
 * (options are only used on first creation).
 */
export function getBreaker(
  name: string,
  options?: Partial<Omit<CircuitBreakerOptions, 'name'>>
): CircuitBreaker {
  let breaker = breakers.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker({ name, ...options });
    breakers.set(name, breaker);
  }
  return breaker;
}

/**
 * Get status of all registered circuit breakers.
 * Useful for health endpoint integration.
 */
export function getAllStatus(): Record<string, CircuitStatus> {
  const result: Record<string, CircuitStatus> = {};
  for (const [name, breaker] of breakers) {
    result[name] = breaker.getStatus();
  }
  return result;
}

/**
 * Reset a specific circuit breaker (for admin / debugging).
 */
export function resetBreaker(name: string): boolean {
  const breaker = breakers.get(name);
  if (breaker) {
    breaker.reset();
    return true;
  }
  return false;
}

/**
 * Clear all breakers (primarily for testing).
 */
export function clearAll(): void {
  breakers.clear();
}

// ============================================
// Pre-register known service breakers
// ============================================

// GitHub CLI calls — slower service, give it more time
getBreaker('github', {
  failureThreshold: 5,
  resetTimeout: 30_000,
  monitorWindow: 60_000,
});

// Clawdbot agent service — may be down if Clawdbot gateway is offline
getBreaker('agent', {
  failureThreshold: 3,
  resetTimeout: 20_000,
  monitorWindow: 60_000,
});

// AI / LLM services — can be flaky
getBreaker('ai', {
  failureThreshold: 5,
  resetTimeout: 45_000,
  monitorWindow: 120_000,
});
