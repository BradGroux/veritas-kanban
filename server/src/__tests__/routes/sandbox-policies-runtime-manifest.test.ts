import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';
import { providerRuntimeManifestFixture } from '../fixtures/provider-runtime-manifest.js';

const { mockDryRunWithTrace, mockGetHostHealth, mockRecordTrace } = vi.hoisted(() => ({
  mockDryRunWithTrace: vi.fn(),
  mockGetHostHealth: vi.fn(),
  mockRecordTrace: vi.fn(),
}));

vi.mock('../../services/sandbox-policy-service.js', () => ({
  getSandboxPolicyService: () => ({
    dryRunWithTrace: mockDryRunWithTrace,
    listPresets: vi.fn(),
    getPreset: vi.fn(),
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
    deletePreset: vi.fn(),
  }),
}));

vi.mock('../../services/agent-host-service.js', () => ({
  getAgentHostService: () => ({ getHealth: mockGetHostHealth }),
}));

vi.mock('../../services/governance-trace-service.js', () => ({
  getGovernanceTraceService: () => ({ record: mockRecordTrace }),
}));

import sandboxPolicyRoutes from '../../routes/sandbox-policies.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sandbox-policies', sandboxPolicyRoutes);
  app.use(errorHandler);
  return app;
}

describe('sandbox policy runtime manifest provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDryRunWithTrace.mockResolvedValue({
      result: { decision: 'allow' },
      trace: { kind: 'sandbox-policy' },
    });
    mockRecordTrace.mockResolvedValue({ id: 'govtrace_fixture' });
  });

  it('resolves public dry-runs from a live registered manifest digest', async () => {
    const manifest = providerRuntimeManifestFixture({ provider: 'codex-sdk' });
    mockGetHostHealth.mockReturnValue({
      hosts: [{ posture: 'connected', providerRuntimeManifests: [manifest] }],
    });

    const response = await request(createApp()).post('/api/sandbox-policies/validate').send({
      presetId: 'codex-repo-contained',
      provider: 'codex-sdk',
      providerRuntimeManifestDigest: manifest.digest,
    });

    expect(response.status).toBe(200);
    expect(mockDryRunWithTrace).toHaveBeenCalledWith({
      presetId: 'codex-repo-contained',
      provider: 'codex-sdk',
      providerRuntimeManifestDigest: manifest.digest,
      providerRuntimeManifest: manifest,
    });
  });

  it('rejects unknown digests and caller-supplied manifest bodies', async () => {
    mockGetHostHealth.mockReturnValue({ hosts: [] });
    const unknown = await request(createApp())
      .post('/api/sandbox-policies/validate')
      .send({
        presetId: 'codex-repo-contained',
        provider: 'codex-sdk',
        providerRuntimeManifestDigest: `sha256:${'f'.repeat(64)}`,
      });
    expect(unknown.status).toBe(409);

    const forged = await request(createApp())
      .post('/api/sandbox-policies/validate')
      .send({
        presetId: 'codex-repo-contained',
        provider: 'codex-sdk',
        providerRuntimeManifest: providerRuntimeManifestFixture({ provider: 'codex-sdk' }),
      });
    expect(forged.status).toBe(400);
    expect(mockDryRunWithTrace).not.toHaveBeenCalled();
  });

  it.each(['stale', 'disconnected'] as const)(
    'rejects manifests from %s hosts',
    async (posture) => {
      const manifest = providerRuntimeManifestFixture({ provider: 'codex-sdk' });
      mockGetHostHealth.mockReturnValue({
        hosts: [{ posture, providerRuntimeManifests: [manifest] }],
      });

      const response = await request(createApp()).post('/api/sandbox-policies/validate').send({
        presetId: 'codex-repo-contained',
        provider: 'codex-sdk',
        providerRuntimeManifestDigest: manifest.digest,
      });
      expect(response.status).toBe(409);
    }
  );

  it('rejects missing digests', async () => {
    const manifest = providerRuntimeManifestFixture({ provider: 'codex-sdk' });
    mockGetHostHealth.mockReturnValue({
      hosts: [{ posture: 'connected', providerRuntimeManifests: [manifest] }],
    });

    const missing = await request(createApp()).post('/api/sandbox-policies/validate').send({
      presetId: 'codex-repo-contained',
      provider: 'codex-sdk',
    });
    expect(missing.status).toBe(400);
  });

  it('rejects provider mismatches', async () => {
    const manifest = providerRuntimeManifestFixture({ provider: 'codex-sdk' });
    mockGetHostHealth.mockReturnValue({
      hosts: [{ posture: 'connected', providerRuntimeManifests: [manifest] }],
    });

    const response = await request(createApp()).post('/api/sandbox-policies/validate').send({
      presetId: 'codex-repo-contained',
      provider: 'openclaw',
      providerRuntimeManifestDigest: manifest.digest,
    });
    expect(response.status).toBe(409);
    expect(mockDryRunWithTrace).not.toHaveBeenCalled();
  });
});
