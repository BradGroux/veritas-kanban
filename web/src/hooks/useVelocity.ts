import { useQuery } from '@tanstack/react-query';

export type VelocityTrend = 'accelerating' | 'steady' | 'slowing';

export interface SprintVelocityPoint {
  sprint: string;                    // Sprint identifier (e.g., "US-100")
  completed: number;                 // Tasks completed in this sprint
  total: number;                     // Total tasks in this sprint
  rollingAverage: number;            // 3-sprint rolling average at this point
  byType: Record<string, number>;    // Breakdown by task type
}

export interface CurrentSprintProgress {
  sprint: string;
  completed: number;
  total: number;
  percentComplete: number;           // 0-100
  vsAverage: number;                 // Percentage vs historical average (-100 to +100+)
}

export interface VelocityMetrics {
  sprints: SprintVelocityPoint[];    // Sprint data (oldest to newest)
  averageVelocity: number;           // Overall average tasks per sprint
  trend: VelocityTrend;              // Current trend indicator
  currentSprint?: CurrentSprintProgress; // Progress on current/active sprint
}

const API_BASE = '/api';

async function fetchVelocity(project?: string, limit = 10): Promise<VelocityMetrics> {
  const params = new URLSearchParams();
  if (project) {
    params.set('project', project);
  }
  params.set('limit', String(limit));
  
  const response = await fetch(`${API_BASE}/metrics/velocity?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch velocity metrics');
  }
  return response.json();
}

export function useVelocity(project?: string, limit = 10) {
  return useQuery({
    queryKey: ['velocity', project, limit],
    queryFn: () => fetchVelocity(project, limit),
    refetchInterval: 60000, // Refresh every minute (velocity changes less frequently)
    staleTime: 30000,
  });
}

// Utility function to get trend color
export function getTrendColor(trend: VelocityTrend): string {
  switch (trend) {
    case 'accelerating':
      return 'text-green-500';
    case 'slowing':
      return 'text-red-500';
    default:
      return 'text-muted-foreground';
  }
}

// Utility function to get trend icon name
export function getTrendIcon(trend: VelocityTrend): 'TrendingUp' | 'TrendingDown' | 'Minus' {
  switch (trend) {
    case 'accelerating':
      return 'TrendingUp';
    case 'slowing':
      return 'TrendingDown';
    default:
      return 'Minus';
  }
}

// Utility function to get trend label
export function getTrendLabel(trend: VelocityTrend): string {
  switch (trend) {
    case 'accelerating':
      return 'Accelerating';
    case 'slowing':
      return 'Slowing';
    default:
      return 'Steady';
  }
}
