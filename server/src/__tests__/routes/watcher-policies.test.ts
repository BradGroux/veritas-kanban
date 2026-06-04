import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/error-handler.js';
import { watcherPolicyRoutes } from '../../routes/watcher-policies.js';
import {
  resetWatcherPolicyServiceForTests,
  WatcherPolicyService,
} from '../../services/watcher-policy-service.js';

vi.mock('../../services/audit-service.js', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

describe('watcher policy routes', () => {
  let app: express.Express;

  beforeEach(() => {
    resetWatcherPolicyServiceForTests(
      new WatcherPolicyService({
        settings: {
          enabled: true,
          globalKillSwitch: false,
          defaultMode: 'auto',
          maxContinuationsPerRun: 3,
          spendCapUsd: 5,
          riskClasses: [
            'destructive_command',
            'credential_reference',
            'recent_test_failure',
            'provider_error',
            'policy_violation',
          ],
          dispatchDenyPatterns: ['never auto deploy'],
          policies: [],
        },
      })
    );

    app = express();
    app.use(express.json());
    app.use('/api/watcher-policies', watcherPolicyRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    resetWatcherPolicyServiceForTests();
  });

  it('returns current watcher continuation settings', async () => {
    const res = await request(app).get('/api/watcher-policies');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      globalKillSwitch: false,
      defaultMode: 'auto',
    });
  });

  it('evaluates continuation requests through the policy service', async () => {
    const res = await request(app).post('/api/watcher-policies/evaluate').send({
      runId: 'run-1',
      agent: 'codex',
      project: 'core',
      prompt: 'never auto deploy this to production',
      continuationCount: 0,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      decision: 'block',
      mode: 'auto',
      auditLogged: true,
    });
    expect(res.body.evidence.map((item: { code: string }) => item.code)).toContain(
      'dispatch_filter'
    );
  });

  it('rejects unknown fields instead of accepting policy bypass metadata', async () => {
    const res = await request(app).post('/api/watcher-policies/evaluate').send({
      runId: 'run-1',
      agent: 'codex',
      bypassPolicy: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
