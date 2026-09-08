import { describe, expect, it, vi } from 'vitest';
vi.mock('../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({ getEvents: async () => [] }),
}));
vi.mock('../services/task-service.js', () => ({ getTaskService: () => ({}) }));
import { getCostPredictionService } from '../services/cost-prediction-service.js';

describe('cost prediction subtask counts', () => {
  it.each([0, 1, 2, 3, 5, 6, 500])('preserves prediction factors for count %i', async (count) => {
    const service = getCostPredictionService();
    const scalar = await service.predict({ subtaskCount: count });
    const stored = await service.predict({ subtasks: Array.from({ length: count }) });
    expect(scalar.factors).toEqual(stored.factors);
    expect(scalar.estimatedCost).toBe(stored.estimatedCost);
  });

  it('uses actual task subtasks when both representations are present', async () => {
    const service = getCostPredictionService();
    const actual = await service.predict({ subtasks: [], subtaskCount: 500 });
    const empty = await service.predict({ subtasks: [] });
    expect(actual.factors).toEqual(empty.factors);
  });
});
