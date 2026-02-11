/**
 * Agent Registry Service
 *
 * Manages agent registration, heartbeat tracking, and capability discovery.
 * Agents register themselves with name, model, capabilities, and metadata.
 * The registry tracks liveness via heartbeats and exposes discovery APIs.
 *
 * Storage: File-based JSON in .veritas-kanban/agent-registry.json
 */

import path from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from '../storage/fs-helpers.js';
import { createLogger } from '../lib/logger.js';
import { getRuntimeDir } from '../utils/paths.js';

const log = createLogger('agent-registry');

// ─── Types ───────────────────────────────────────────────────────

export interface AgentCapability {
  /** Capability name (e.g., "code", "research", "deploy", "review") */
  name: string;
  /** Optional description */
  description?: string;
}

export interface RegisteredAgent {
  /** Unique agent identifier (e.g., "veritas", "codex-1", "sonnet-research") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Model identifier (e.g., "claude-opus-4-6", "gpt-5.2-codex") */
  model?: string;
  /** Provider (e.g., "anthropic", "openai-codex") */
  provider?: string;
  /** Agent capabilities */
  capabilities: AgentCapability[];
  /** Agent version or build info */
  version?: string;
  /** Freeform metadata */
  metadata?: Record<string, unknown>;
  /** Current status */
  status: 'online' | 'busy' | 'idle' | 'offline';
  /** ISO timestamp of registration */
  registeredAt: string;
  /** ISO timestamp of last heartbeat */
  lastHeartbeat: string;
  /** Current task ID (if working on something) */
  currentTaskId?: string;
  /** Current task title */
  currentTaskTitle?: string;
  /** Session key (for OpenClaw/orchestrator integration) */
  sessionKey?: string;
}

export interface AgentRegistration {
  id: string;
  name: string;
  model?: string;
  provider?: string;
  capabilities?: AgentCapability[];
  version?: string;
  metadata?: Record<string, unknown>;
  sessionKey?: string;
}

export interface AgentHeartbeat {
  status?: 'online' | 'busy' | 'idle';
  currentTaskId?: string;
  currentTaskTitle?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRegistryData {
  agents: Record<string, RegisteredAgent>;
  lastUpdated: string;
}

// ─── Configuration ───────────────────────────────────────────────

/** How long before an agent is considered offline (no heartbeat) */
const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** How often to check for stale agents */
const STALE_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

// ─── Service ─────────────────────────────────────────────────────

class AgentRegistryService {
  private agents: Map<string, RegisteredAgent> = new Map();
  private dataDir: string;
  private filePath: string;
  private legacyFilePath: string;
  private staleCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.dataDir = getRuntimeDir();
    this.filePath = path.join(this.dataDir, 'agent-registry.json');
    this.legacyFilePath = path.join(
      process.env.VERITAS_DATA_DIR || path.join(process.cwd(), '..', '.veritas-kanban'),
      'agent-registry.json'
    );
    this.migrateLegacyRegistry();
    this.load();
    this.startStaleCheck();
  }

  /**
   * Register or update an agent in the registry.
   */
  register(registration: AgentRegistration): RegisteredAgent {
    const existing = this.agents.get(registration.id);
    const now = new Date().toISOString();

    const agent: RegisteredAgent = {
      id: registration.id,
      name: registration.name,
      model: registration.model ?? existing?.model,
      provider: registration.provider ?? existing?.provider,
      capabilities: registration.capabilities ?? existing?.capabilities ?? [],
      version: registration.version ?? existing?.version,
      metadata: registration.metadata ?? existing?.metadata,
      sessionKey: registration.sessionKey ?? existing?.sessionKey,
      status: 'online',
      registeredAt: existing?.registeredAt ?? now,
      lastHeartbeat: now,
      currentTaskId: existing?.currentTaskId,
      currentTaskTitle: existing?.currentTaskTitle,
    };

    this.agents.set(registration.id, agent);
    this.persist();

    log.info(
      { agentId: agent.id, model: agent.model, capabilities: agent.capabilities.length },
      `Agent registered: ${agent.name}`
    );

    return agent;
  }

  /**
   * Process a heartbeat from an agent.
   */
  heartbeat(agentId: string, update?: AgentHeartbeat): RegisteredAgent | null {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return null;
    }

    agent.lastHeartbeat = new Date().toISOString();
    if (update?.status) agent.status = update.status;
    if (update?.currentTaskId !== undefined)
      agent.currentTaskId = update.currentTaskId || undefined;
    if (update?.currentTaskTitle !== undefined)
      agent.currentTaskTitle = update.currentTaskTitle || undefined;
    if (update?.metadata) agent.metadata = { ...agent.metadata, ...update.metadata };

    this.agents.set(agentId, agent);
    this.persist();

    return agent;
  }

  /**
   * Deregister an agent.
   */
  deregister(agentId: string): boolean {
    const existed = this.agents.delete(agentId);
    if (existed) {
      this.persist();
      log.info({ agentId }, `Agent deregistered: ${agentId}`);
    }
    return existed;
  }

  /**
   * Get a specific agent by ID.
   */
  get(agentId: string): RegisteredAgent | null {
    return this.agents.get(agentId) ?? null;
  }

  /**
   * List all registered agents, optionally filtered.
   */
  list(filters?: { status?: string; capability?: string }): RegisteredAgent[] {
    let agents = Array.from(this.agents.values());

    if (filters?.status) {
      agents = agents.filter((a) => a.status === filters.status);
    }

    if (filters?.capability) {
      const cap = filters.capability.toLowerCase();
      agents = agents.filter((a) => a.capabilities.some((c) => c.name.toLowerCase() === cap));
    }

    return agents;
  }

  /**
   * Find agents that have a specific capability.
   */
  findByCapability(capability: string): RegisteredAgent[] {
    const cap = capability.toLowerCase();
    return Array.from(this.agents.values()).filter(
      (a) => a.status !== 'offline' && a.capabilities.some((c) => c.name.toLowerCase() === cap)
    );
  }

  /**
   * Get registry statistics.
   */
  stats(): {
    total: number;
    online: number;
    busy: number;
    idle: number;
    offline: number;
    capabilities: string[];
  } {
    const agents = Array.from(this.agents.values());
    const allCaps = new Set<string>();
    for (const agent of agents) {
      for (const cap of agent.capabilities) {
        allCaps.add(cap.name);
      }
    }

    return {
      total: agents.length,
      online: agents.filter((a) => a.status === 'online').length,
      busy: agents.filter((a) => a.status === 'busy').length,
      idle: agents.filter((a) => a.status === 'idle').length,
      offline: agents.filter((a) => a.status === 'offline').length,
      capabilities: Array.from(allCaps).sort(),
    };
  }

  /**
   * Mark stale agents as offline.
   */
  private checkStaleAgents(): void {
    const now = Date.now();
    let changed = false;

    for (const agent of this.agents.values()) {
      if (agent.status === 'offline') continue;

      const lastBeat = new Date(agent.lastHeartbeat).getTime();
      if (now - lastBeat > HEARTBEAT_TIMEOUT_MS) {
        agent.status = 'offline';
        changed = true;
        log.info(
          { agentId: agent.id, lastHeartbeat: agent.lastHeartbeat },
          `Agent marked offline (heartbeat timeout): ${agent.id}`
        );
      }
    }

    if (changed) {
      this.persist();
    }
  }

  private startStaleCheck(): void {
    this.staleCheckInterval = setInterval(() => this.checkStaleAgents(), STALE_CHECK_INTERVAL_MS);
  }

  private migrateLegacyRegistry(): void {
    if (this.legacyFilePath === this.filePath) return;

    if (existsSync(this.legacyFilePath) && !existsSync(this.filePath)) {
      try {
        const dir = path.dirname(this.filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        const data = readFileSync(this.legacyFilePath, 'utf-8');
        writeFileSync(this.filePath, data, 'utf-8');
        log.info(
          { from: this.legacyFilePath, to: this.filePath },
          'Migrated agent registry data to the runtime directory'
        );
      } catch (err) {
        log.warn({ err }, 'Failed to migrate legacy agent registry data');
      }
    }
  }

  /**
   * Load registry from disk.
   */
  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw) as AgentRegistryData;
        if (data.agents) {
          for (const [id, agent] of Object.entries(data.agents)) {
            this.agents.set(id, agent);
          }
          log.info({ count: this.agents.size }, 'Agent registry loaded from disk');
        }
      }
    } catch (err) {
      log.warn({ err }, 'Could not load agent registry, starting fresh');
    }
  }

  /**
   * Persist registry to disk.
   */
  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data: AgentRegistryData = {
        agents: Object.fromEntries(this.agents),
        lastUpdated: new Date().toISOString(),
      };

      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      log.warn({ err }, 'Failed to persist agent registry');
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }
  }
}

// Singleton
let instance: AgentRegistryService | null = null;

export function getAgentRegistryService(): AgentRegistryService {
  if (!instance) {
    instance = new AgentRegistryService();
  }
  return instance;
}

export function disposeAgentRegistryService(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
