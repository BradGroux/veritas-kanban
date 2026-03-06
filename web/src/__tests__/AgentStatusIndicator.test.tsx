/**
 * Tests for components/shared/AgentStatusIndicator.tsx — agent status states.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentStatusIndicator } from '@/components/shared/AgentStatusIndicator';

// ── Mocks ────────────────────────────────────────────────────

// Mock realtime status hook — allows us to control returned data
const mockRealtimeAgentStatus = vi.fn();
vi.mock('@/hooks/useAgentStatus', () => ({
  useRealtimeAgentStatus: () => mockRealtimeAgentStatus(),
}));

// Mock WebSocket context used by indicator
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketStatus: () => ({ isConnected: true }),
}));

// Mock the activity API to avoid real requests
vi.mock('@/lib/api', () => ({
  api: {
    activity: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

// ── Helpers ──────────────────────────────────────────────────

function renderIndicator(props: { onOpenActivityLog?: () => void } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AgentStatusIndicator {...props} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────

describe('AgentStatusIndicator', () => {
  it('falls back to idle state when data is not yet available', () => {
    mockRealtimeAgentStatus.mockReturnValue(undefined);

    renderIndicator();
    const button = screen.getByRole('status');
    expect(button.getAttribute('aria-label')).toContain('Agent status: Idle');
  });

  it('shows idle state with gray dot', () => {
    mockRealtimeAgentStatus.mockReturnValue({
      status: 'idle',
      subAgentCount: 0,
      activeAgents: [],
      lastUpdated: new Date().toISOString(),
      isConnected: true,
      isStale: false,
    });

    renderIndicator();
    const button = screen.getByRole('status');
    expect(button.getAttribute('aria-label')).toContain('Agent status: Idle');

    // Idle dot is gray (#6b7280)
    const dot = button.querySelector('.agent-status-dot');
    expect(dot).toBeDefined();
  });

  it('shows working state with active task title', () => {
    mockRealtimeAgentStatus.mockReturnValue({
      status: 'working',
      subAgentCount: 0,
      activeAgents: [],
      activeTask: 'task-1',
      activeTaskTitle: 'Build Feature',
      lastUpdated: new Date().toISOString(),
      isConnected: true,
      isStale: false,
    });

    renderIndicator();
    const button = screen.getByRole('status');
    expect(button.getAttribute('aria-label')).toContain('Working');
    expect(button.getAttribute('aria-label')).toContain('Build Feature');
  });

  it('shows sub-agents state with count', () => {
    mockRealtimeAgentStatus.mockReturnValue({
      status: 'sub-agent',
      subAgentCount: 3,
      activeAgents: [],
      lastUpdated: new Date().toISOString(),
      isConnected: true,
      isStale: false,
    });

    renderIndicator();
    const button = screen.getByRole('status');
    expect(button.getAttribute('aria-label')).toContain('3 agents');
  });

  it('shows error state', () => {
    mockRealtimeAgentStatus.mockReturnValue({
      status: 'error',
      subAgentCount: 0,
      activeAgents: [],
      error: 'Agent crashed',
      lastUpdated: new Date().toISOString(),
      isConnected: true,
      isStale: false,
    });

    renderIndicator();
    const button = screen.getByRole('status');
    expect(button.getAttribute('aria-label')).toContain('Error');
  });

  it('shows error state when query itself fails', () => {
    mockRealtimeAgentStatus.mockReturnValue({
      status: 'error',
      subAgentCount: 0,
      activeAgents: [],
      error: 'Network failure',
      lastUpdated: new Date().toISOString(),
      isConnected: true,
      isStale: false,
    });

    renderIndicator();
    const button = screen.getByRole('status');
    expect(button.getAttribute('aria-label')).toContain('Error');
  });

  it('shows thinking state', () => {
    mockRealtimeAgentStatus.mockReturnValue({
      status: 'thinking',
      subAgentCount: 0,
      activeAgents: [],
      lastUpdated: new Date().toISOString(),
      isConnected: true,
      isStale: false,
    });

    renderIndicator();
    const button = screen.getByRole('status');
    expect(button.getAttribute('aria-label')).toContain('Thinking');
  });
});
