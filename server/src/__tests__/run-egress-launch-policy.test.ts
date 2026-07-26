import { describe, expect, it } from 'vitest';
import { PROVIDER_RUNTIME_PROBE_REVISION } from '@veritas-kanban/shared';
import { EgressPolicyService } from '../services/egress-policy-service.js';
import { getProviderRuntimeAdapterDefinition } from '../services/provider-runtime-adapter-registry.js';
import {
  RunEgressGatewayService,
  runEgressPolicyRequiresGateway,
} from '../services/run-egress-gateway-service.js';

const policyService = new EgressPolicyService();

describe('run egress launch policy', () => {
  it('starts the gateway only when a policy needs selective transport enforcement', () => {
    expect(
      runEgressPolicyRequiresGateway(
        policyService.compile({
          defaultEgress: 'deny',
          allowedHosts: [],
          allowedMethods: [],
          allowedPathPrefixes: [],
          blockPrivateNetwork: true,
          blockMetadataEndpoints: true,
          blockLoopback: true,
        })
      )
    ).toBe(false);

    expect(
      runEgressPolicyRequiresGateway(
        policyService.compile({
          defaultEgress: 'deny',
          allowedHosts: ['api.example.com'],
          allowedMethods: [],
          allowedPathPrefixes: [],
          blockPrivateNetwork: true,
          blockMetadataEndpoints: true,
          blockLoopback: true,
        })
      )
    ).toBe(true);

    expect(
      runEgressPolicyRequiresGateway(
        policyService.compile({
          defaultEgress: 'allow',
          allowedHosts: [],
          allowedMethods: [],
          allowedPathPrefixes: [],
          blockPrivateNetwork: false,
          blockMetadataEndpoints: false,
          blockLoopback: false,
        })
      )
    ).toBe(false);

    expect(
      runEgressPolicyRequiresGateway(
        policyService.compile({
          defaultEgress: 'allow',
          allowedHosts: [],
          deniedHosts: ['metadata.google.internal'],
          allowedMethods: [],
          allowedPathPrefixes: [],
          blockPrivateNetwork: true,
          blockMetadataEndpoints: true,
          blockLoopback: false,
        })
      )
    ).toBe(true);
  });

  it('reports local gateway injection as host-enforced and remote OpenClaw as advisory', () => {
    expect(PROVIDER_RUNTIME_PROBE_REVISION).toBe(16);

    for (const provider of [
      'codex-cli',
      'codex-sdk',
      'codex-app-server',
      'claude-code',
      'acp-stdio',
      'hermes-cli',
    ] as const) {
      const capability = getProviderRuntimeAdapterDefinition(provider).capabilities.find(
        (candidate) => candidate.id === 'network.allowlist'
      );
      expect(capability).toMatchObject({
        state: 'supported',
        source: 'host-enforced',
      });
    }

    expect(
      getProviderRuntimeAdapterDefinition('openclaw').capabilities.find(
        (candidate) => candidate.id === 'network.allowlist'
      )
    ).toMatchObject({
      state: 'advisory',
    });
  });

  it('rejects unsupported upstream proxy schemes before binding listeners', async () => {
    const gateway = new RunEgressGatewayService(policyService);
    await expect(
      gateway.start({
        runId: 'run-invalid-upstream',
        policy: policyService.compile({
          defaultEgress: 'deny',
          allowedHosts: ['api.example.com'],
          allowedMethods: [],
          allowedPathPrefixes: [],
          blockPrivateNetwork: true,
          blockMetadataEndpoints: true,
          blockLoopback: true,
        }),
        upstreamProxyUrl: 'https://proxy.example.com:8443',
      })
    ).rejects.toThrow(/must be an HTTP origin/i);
  });
});
