/**
 * MultiAgentPanel — Shows all registered agents with real-time status
 *
 * Combines data from:
 * - Agent Registry (all registered agents, capabilities, models)
 * - Real-time Agent Status (currently active agents, live tasks)
 *
 * Design: Compact cards with status indicators, current task, model info.
 * Color scheme: green=online, purple=busy/sub-agent, gray=offline, red=error
 */

import { useQuery } from '@tanstack/react-query';
import { useRealtimeAgentStatus } from '@/hooks/useAgentStatus';
import { api } from '@/lib/api';
import type { RegisteredAgent } from '@/lib/api/agent';
import {
  Clock,
  Cpu,
  Globe,
  Zap,
  CircleDot,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState, useMemo } from 'react';

// ─── Helpers ─────────────────────────────────────────────────────

function formatTimeAgo(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const STATUS_STYLES = {
  online: { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)', label: 'Online' },
  busy: { color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)', label: 'Busy' },
  idle: { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.08)', label: 'Idle' },
  offline: { color: '#6b7280', bg: 'rgba(107, 114, 128, 0.08)', label: 'Offline' },
  error: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', label: 'Error' },
} as const;

// ─── Agent Card ──────────────────────────────────────────────────

interface AgentCardProps {
  agent: RegisteredAgent;
  isActive: boolean;
  currentTaskTitle?: string;
  currentTaskId?: string;
  onTaskClick?: (taskId: string) => void;
}

function AgentCard({ agent, isActive, currentTaskTitle, currentTaskId, onTaskClick }: AgentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const effectiveStatus = isActive ? 'busy' : (agent.status as keyof typeof STATUS_STYLES);
  const style = STATUS_STYLES[effectiveStatus] || STATUS_STYLES.offline;

  return (
    <div
      className="rounded-md border transition-all"
      style={{ borderColor: `${style.color}30`, backgroundColor: style.bg }}
    >
      {/* Header */}
      <button
        className="flex items-center gap-2 w-full text-left px-2.5 py-2 hover:bg-white/5 transition-colors rounded-md"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status dot */}
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: style.color }}
        />

        {/* Name + model */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: style.color }}>
            {agent.name || agent.id}
          </div>
          {agent.model && (
            <div className="text-[10px] text-muted-foreground/70 truncate flex items-center gap-1">
              <Cpu className="w-2.5 h-2.5" />
              {agent.model}
            </div>
          )}
        </div>

        {/* Status badge */}
        <span
          className="text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
          style={{ color: style.color, backgroundColor: `${style.color}20` }}
        >
          {style.label}
        </span>

        {/* Expand chevron */}
        {(agent.capabilities?.length || 0) > 0 && (
          <span className="text-muted-foreground/40">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        )}
      </button>

      {/* Active task */}
      {isActive && (currentTaskTitle || currentTaskId) && (
        <div className="px-2.5 pb-2">
          <button
            className="text-[11px] text-foreground/80 hover:text-foreground hover:underline truncate block w-full text-left"
            onClick={() => currentTaskId && onTaskClick?.(currentTaskId)}
          >
            <Zap className="w-3 h-3 inline mr-1" style={{ color: style.color }} />
            {currentTaskTitle || currentTaskId}
          </button>
        </div>
      )}

      {/* Expanded: capabilities + metadata */}
      {expanded && (
        <div className="px-2.5 pb-2 space-y-1.5 border-t border-border/30 pt-1.5">
          {agent.capabilities && agent.capabilities.length > 0 && (
            <div>
              <div className="text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1">
                Capabilities
              </div>
              <div className="flex flex-wrap gap-1">
                {agent.capabilities.map((cap) => (
                  <span
                    key={cap.name}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground"
                    title={cap.description}
                  >
                    {cap.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {agent.provider && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <Globe className="w-2.5 h-2.5" />
              {agent.provider}
              {agent.version && <span>v{agent.version}</span>}
            </div>
          )}

          {agent.lastHeartbeat && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <Clock className="w-2.5 h-2.5" />
              Heartbeat {formatTimeAgo(agent.lastHeartbeat)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────

interface MultiAgentPanelProps {
  onTaskClick?: (taskId: string) => void;
}

export function MultiAgentPanel({ onTaskClick }: MultiAgentPanelProps) {
  const realtimeStatus = useRealtimeAgentStatus();

  // Fetch registered agents from registry
  const { data: registeredAgents = [] } = useQuery({
    queryKey: ['agent-registry'],
    queryFn: () => api.registry.list(),
    refetchInterval: 30_000, // Refresh every 30s
    retry: 1,
  });

  // Fetch registry stats
  const { data: stats } = useQuery({
    queryKey: ['agent-registry-stats'],
    queryFn: () => api.registry.stats(),
    refetchInterval: 30_000,
    retry: 1,
  });

  // Merge registry data with real-time active agents
  const agentCards = useMemo(() => {
    const activeMap = new Map<string, { taskId?: string; taskTitle?: string }>();

    // Map currently active agents from real-time status
    for (const active of realtimeStatus.activeAgents) {
      activeMap.set(active.agent.toLowerCase(), {
        taskId: active.taskId,
        taskTitle: active.taskTitle,
      });
    }

    // Start with registered agents
    const cards = registeredAgents.map((agent) => ({
      agent,
      isActive: activeMap.has(agent.id.toLowerCase()) || activeMap.has(agent.name.toLowerCase()),
      activeInfo: activeMap.get(agent.id.toLowerCase()) || activeMap.get(agent.name.toLowerCase()),
    }));

    // Add any active agents that aren't in the registry
    for (const [key, info] of activeMap.entries()) {
      const exists = cards.some(
        (c) => c.agent.id.toLowerCase() === key || c.agent.name.toLowerCase() === key
      );
      if (!exists) {
        cards.push({
          agent: {
            id: key,
            name: key,
            status: 'online' as const,
            registeredAt: new Date().toISOString(),
          },
          isActive: true,
          activeInfo: info,
        });
      }
    }

    // Sort: active first, then by name
    cards.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return a.agent.name.localeCompare(b.agent.name);
    });

    return cards;
  }, [registeredAgents, realtimeStatus.activeAgents]);

  return (
    <div className="space-y-2">
      {/* Stats bar */}
      {stats && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
          <span className="flex items-center gap-1">
            <CircleDot className="w-2.5 h-2.5 text-green-500" />
            {stats.online + stats.busy} active
          </span>
          {stats.busy > 0 && (
            <span className="flex items-center gap-1">
              <CircleDot className="w-2.5 h-2.5 text-purple-500" />
              {stats.busy} busy
            </span>
          )}
          <span className="flex items-center gap-1">
            <CircleDot className="w-2.5 h-2.5 text-gray-500" />
            {stats.total} total
          </span>
        </div>
      )}

      {/* Agent cards */}
      {agentCards.length > 0 ? (
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {agentCards.map((card) => (
            <AgentCard
              key={card.agent.id}
              agent={card.agent}
              isActive={card.isActive}
              currentTaskTitle={card.activeInfo?.taskTitle}
              currentTaskId={card.activeInfo?.taskId}
              onTaskClick={onTaskClick}
            />
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground/40 py-3 text-center">
          No agents registered.
          <br />
          <span className="text-[10px]">
            Use <code className="bg-muted/50 px-1 rounded">POST /api/agents/register</code> to add agents.
          </span>
        </div>
      )}
    </div>
  );
}
