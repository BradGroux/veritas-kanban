import { describe, expect, it } from 'vitest';
import type { SandboxNetworkRules } from '@veritas-kanban/shared';
import { EgressPolicyService } from '../services/egress-policy-service.js';

const service = new EgressPolicyService();

function rules(overrides: Partial<SandboxNetworkRules> = {}): SandboxNetworkRules {
  return {
    defaultEgress: 'deny',
    allowedHosts: [],
    deniedHosts: [],
    allowedMethods: [],
    allowedPathPrefixes: [],
    blockPrivateNetwork: true,
    blockMetadataEndpoints: true,
    blockLoopback: true,
    allowApprovals: false,
    dangerouslyAllowGlobalWildcard: false,
    ...overrides,
  };
}

describe('EgressPolicyService', () => {
  it('blocks by default when no allow rule exists', () => {
    const policy = service.compile(rules());

    expect(
      service.evaluate(policy, {
        protocol: 'https',
        host: 'api.example.com',
        port: 443,
        resolvedAddresses: ['93.184.216.34'],
      })
    ).toMatchObject({
      decision: 'block',
      reason: 'default-deny',
      approvalEligible: false,
    });
  });

  it('normalizes scoped wildcards and rejects an unapproved global allow wildcard', () => {
    expect(() => service.compile(rules({ allowedHosts: ['*'] }))).toThrow(
      /dangerouslyAllowGlobalWildcard/
    );

    const policy = service.compile(
      rules({
        allowedHosts: ['*.Example.COM', 'api.example.com', '*.example.com'],
      })
    );
    expect(policy.allowedHosts).toEqual([
      { kind: 'exact', value: 'api.example.com' },
      { kind: 'subdomain', value: 'example.com' },
    ]);
    expect(
      service.evaluate(policy, {
        protocol: 'http',
        host: 'packages.example.com.',
        port: 80,
        resolvedAddresses: ['93.184.216.34'],
      })
    ).toMatchObject({ decision: 'allow', reason: 'allowed-by-host-rule' });
    expect(
      service.evaluate(policy, {
        protocol: 'http',
        host: 'example.com',
        port: 80,
        resolvedAddresses: ['93.184.216.34'],
      })
    ).toMatchObject({ decision: 'block', reason: 'default-deny' });
  });

  it('gives explicit deny rules precedence over dangerous global allow', () => {
    const policy = service.compile(
      rules({
        allowedHosts: ['*'],
        deniedHosts: ['metadata.example.com'],
        dangerouslyAllowGlobalWildcard: true,
      })
    );

    expect(
      service.evaluate(policy, {
        protocol: 'http',
        host: 'metadata.example.com',
        port: 80,
        resolvedAddresses: ['93.184.216.34'],
      })
    ).toMatchObject({
      decision: 'block',
      reason: 'denied-host',
      matchedRule: { kind: 'exact', value: 'metadata.example.com' },
      approvalEligible: false,
    });
  });

  it('enforces HTTP methods and path prefixes without retaining query strings', () => {
    const policy = service.compile(
      rules({
        allowedHosts: ['api.example.com'],
        allowedMethods: ['GET'],
        allowedPathPrefixes: ['/v1/data'],
        allowApprovals: true,
      })
    );

    expect(
      service.evaluate(policy, {
        protocol: 'http',
        host: 'api.example.com',
        port: 80,
        method: 'GET',
        path: '/v1/data/items?secret=value',
        resolvedAddresses: ['93.184.216.34'],
      })
    ).toMatchObject({ decision: 'allow' });
    expect(
      service.evaluate(policy, {
        protocol: 'http',
        host: 'api.example.com',
        port: 80,
        method: 'POST',
        path: '/v1/data/items',
        resolvedAddresses: ['93.184.216.34'],
      })
    ).toMatchObject({
      decision: 'block',
      reason: 'method-not-allowed',
      approvalEligible: true,
    });
    expect(
      service.evaluate(policy, {
        protocol: 'http',
        host: 'api.example.com',
        port: 80,
        method: 'GET',
        path: '/v1/database',
        resolvedAddresses: ['93.184.216.34'],
      })
    ).toMatchObject({ decision: 'block', reason: 'path-not-allowed' });
  });

  it('fails closed when encrypted traffic cannot satisfy method or path rules', () => {
    const policy = service.compile(
      rules({
        allowedHosts: ['api.example.com'],
        allowedMethods: ['GET'],
        allowedPathPrefixes: ['/v1'],
      })
    );
    const input = {
      protocol: 'https' as const,
      host: 'api.example.com',
      port: 443,
      method: 'GET',
      path: '/v1/models',
      resolvedAddresses: ['93.184.216.34'],
    };

    expect(service.evaluate(policy, input)).toMatchObject({
      decision: 'block',
      reason: 'tls-inspection-required',
    });
    expect(service.evaluate(policy, { ...input, tlsInspected: true })).toMatchObject({
      decision: 'allow',
    });
  });

  it('blocks private, link-local, loopback, and metadata destinations after resolution', () => {
    const policy = service.compile(
      rules({
        allowedHosts: ['*.example.com', 'metadata.google.internal'],
      })
    );
    const evaluate = (host: string, address: string) =>
      service.evaluate(policy, {
        protocol: 'http',
        host,
        port: 80,
        resolvedAddresses: [address],
      });

    expect(evaluate('private.example.com', '10.20.30.40')).toMatchObject({
      reason: 'private-network-blocked',
      blockedAddressClass: 'private',
    });
    expect(evaluate('link.example.com', '169.254.10.20')).toMatchObject({
      reason: 'private-network-blocked',
      blockedAddressClass: 'link-local',
    });
    expect(evaluate('loop.example.com', '::1')).toMatchObject({
      reason: 'loopback-blocked',
      blockedAddressClass: 'loopback',
    });
    expect(evaluate('metadata.google.internal', '93.184.216.34')).toMatchObject({
      reason: 'metadata-endpoint-blocked',
      blockedAddressClass: 'metadata',
    });
  });

  it('resolves hostnames before allowing transport and fails closed on lookup errors', async () => {
    const privateResolver = new EgressPolicyService(async () => ['127.0.0.1']);
    const failedResolver = new EgressPolicyService(async () => {
      throw new Error('DNS unavailable');
    });
    const policy = service.compile(rules({ allowedHosts: ['api.example.com'] }));
    const input = {
      protocol: 'http' as const,
      host: 'api.example.com',
      port: 80,
    };

    await expect(privateResolver.evaluateResolved(policy, input)).resolves.toMatchObject({
      decision: 'block',
      reason: 'loopback-blocked',
    });
    await expect(failedResolver.evaluateResolved(policy, input)).resolves.toMatchObject({
      decision: 'block',
      reason: 'invalid-destination',
    });
  });

  it('produces deterministic policy and redacted destination identities', () => {
    const left = service.compile(
      rules({ allowedHosts: ['b.example.com', 'a.example.com'], allowedMethods: ['post', 'GET'] })
    );
    const right = service.compile(
      rules({ allowedHosts: ['a.example.com', 'b.example.com'], allowedMethods: ['GET', 'POST'] })
    );
    expect(left.policyHash).toBe(right.policyHash);

    const decision = service.evaluate(left, {
      protocol: 'http',
      host: 'unlisted.internal.example',
      port: 80,
      resolvedAddresses: ['93.184.216.34'],
    });
    expect(decision.hostKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(decision)).not.toContain('unlisted.internal.example');
  });
});
