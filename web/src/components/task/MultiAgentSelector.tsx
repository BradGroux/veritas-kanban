/**
 * MultiAgentSelector — Select multiple agents for a task
 *
 * Shows assigned agents as removable chips with an "Add Agent" dropdown.
 * Supports both registry agents and custom agent names.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AgentType } from '@veritas-kanban/shared';
import { X, Plus, UserPlus, Bot } from 'lucide-react';

interface MultiAgentSelectorProps {
  /** Currently assigned agents */
  agents: AgentType[];
  /** Primary agent (backward compat) */
  primaryAgent?: AgentType | 'auto';
  /** Called when agents list changes */
  onChange: (agents: AgentType[], primaryAgent?: AgentType | 'auto') => void;
  /** Compact mode for inline display */
  compact?: boolean;
}

const AGENT_COLORS: Record<string, string> = {
  veritas: '#8b5cf6',
  'claude-code': '#f97316',
  amp: '#06b6d4',
  copilot: '#3b82f6',
  gemini: '#22c55e',
  auto: '#6b7280',
};

function getAgentColor(agent: string): string {
  return AGENT_COLORS[agent.toLowerCase()] || '#8b5cf6';
}

export function MultiAgentSelector({
  agents,
  primaryAgent,
  onChange,
  compact = false,
}: MultiAgentSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [customInput, setCustomInput] = useState('');

  // Fetch registered agents from registry
  const { data: registeredAgents = [] } = useQuery({
    queryKey: ['agent-registry-for-selector'],
    queryFn: () => api.registry.list(),
    staleTime: 60_000,
    retry: 1,
  });

  const availableAgents = registeredAgents
    .filter((a) => !agents.includes(a.id) && !agents.includes(a.name))
    .map((a) => ({ id: a.id, name: a.name, model: a.model }));

  const addAgent = (agentId: string) => {
    const newAgents = [...agents, agentId];
    const primary = newAgents.length === 1 ? agentId : primaryAgent;
    onChange(newAgents, primary);
    setShowDropdown(false);
    setCustomInput('');
  };

  const removeAgent = (agentId: string) => {
    const newAgents = agents.filter((a) => a !== agentId);
    // If we removed the primary, promote next
    const primary = primaryAgent === agentId ? newAgents[0] || undefined : primaryAgent;
    onChange(newAgents, primary);
  };

  const setPrimary = (agentId: string) => {
    onChange(agents, agentId);
  };

  const addCustom = () => {
    const trimmed = customInput.trim().toLowerCase();
    if (trimmed && !agents.includes(trimmed)) {
      addAgent(trimmed);
    }
  };

  return (
    <div className="space-y-1.5">
      {/* Agent chips */}
      <div className="flex flex-wrap gap-1.5">
        {agents.length === 0 && !compact && (
          <span className="text-xs text-muted-foreground/50 italic">No agents assigned</span>
        )}

        {agents.map((agent) => {
          const color = getAgentColor(agent);
          const isPrimary = agent === primaryAgent;
          return (
            <span
              key={agent}
              className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                isPrimary ? 'ring-1' : ''
              }`}
              style={{
                backgroundColor: `${color}20`,
                color: color,
                ['--tw-ring-color' as string]: color,
              }}
              onClick={() => setPrimary(agent)}
              title={isPrimary ? 'Primary agent' : 'Click to make primary'}
            >
              <Bot className="w-3 h-3" />
              {agent}
              {isPrimary && <span className="text-[8px] font-bold opacity-60">★</span>}
              <button
                className="ml-0.5 hover:bg-white/20 rounded-full p-0.5 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAgent(agent);
                }}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          );
        })}

        {/* Add button */}
        <button
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground px-2 py-0.5 rounded-full border border-dashed border-muted-foreground/20 hover:border-muted-foreground/40 transition-colors"
          onClick={() => setShowDropdown(!showDropdown)}
        >
          <Plus className="w-3 h-3" />
          {compact ? '' : 'Add'}
        </button>
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="bg-popover border rounded-lg shadow-lg p-2 space-y-1 max-h-[200px] overflow-y-auto">
          {/* Registry agents */}
          {availableAgents.length > 0 && (
            <>
              <div className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider px-1">
                Registered
              </div>
              {availableAgents.map((agent) => (
                <button
                  key={agent.id}
                  className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-muted/50 transition-colors"
                  onClick={() => addAgent(agent.id)}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: getAgentColor(agent.id) }}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{agent.name}</div>
                    {agent.model && (
                      <div className="text-[10px] text-muted-foreground/60">{agent.model}</div>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}

          {/* Custom agent input */}
          <div className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider px-1 pt-1">
            Custom
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              className="flex-1 text-xs px-2 py-1 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Agent name..."
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustom()}
              autoFocus
            />
            <button
              className="p-1 rounded hover:bg-muted/50 text-muted-foreground"
              onClick={addCustom}
            >
              <UserPlus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
