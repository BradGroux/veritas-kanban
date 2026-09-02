import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SystemHealthBar } from '@/components/layout/SystemHealthBar';

const mockUseSystemHealth = vi.fn();

vi.mock('@/hooks/useSystemHealth', () => ({
  useSystemHealth: () => mockUseSystemHealth(),
}));

const baseSignals = {
  agents: { status: 'ok', total: 0, online: 0, offline: 0 },
  operations: { status: 'ok', recentRuns: 0, successRate: 100, failedRuns: 0 },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('system health banner memory status', () => {
  it('renders Stable and Memory: OK for normal V8 allocation', () => {
    mockUseSystemHealth.mockReturnValue(
      hookResult({
        status: 'stable',
        signals: {
          ...baseSignals,
          system: { status: 'ok', storage: true, disk: true, memory: true },
        },
      })
    );

    render(<SystemHealthBar />);
    expect(screen.getByText('Stable')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /System health: Stable/ }));
    expect(screen.getByText('Memory: OK')).toBeTruthy();
    expect(screen.queryByText('Memory: High')).toBeNull();
  });

  it('renders the real memory warning detail', () => {
    mockUseSystemHealth.mockReturnValue(
      hookResult({
        status: 'reviewing',
        signals: {
          ...baseSignals,
          system: { status: 'warn', storage: true, disk: true, memory: false },
        },
      })
    );

    render(<SystemHealthBar />);
    expect(screen.getByText('Reviewing')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /System health: Reviewing/ }));
    expect(screen.getByText('Memory: High')).toBeTruthy();
  });
});

function hookResult(data: unknown) {
  return {
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    error: null,
  };
}
