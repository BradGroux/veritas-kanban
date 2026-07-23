import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  CredentialAction,
  CredentialDefinitionInput,
  CredentialRunBinding,
} from '@veritas-kanban/shared';
import {
  CredentialBrokerService,
  EnvironmentCredentialSecretSource,
  parseCredentialPlaceholder,
} from '../services/credential-broker-service.js';
import {
  FileCredentialBrokerRepository,
  InMemoryCredentialBrokerRepository,
  type CredentialBrokerRepository,
} from '../storage/credential-broker-repository.js';

const MANIFEST_DIGEST = `sha256:${'a'.repeat(64)}`;
const ARGUMENTS_DIGEST = `sha256:${'b'.repeat(64)}`;
const SECRET = 'credential-sensitive-value';

function definition(overrides: Partial<CredentialDefinitionInput> = {}): CredentialDefinitionInput {
  return {
    id: 'github-token',
    name: 'GitHub token',
    enabled: true,
    source: {
      kind: 'environment',
      reference: 'VK_TEST_GITHUB_TOKEN',
    },
    scope: {
      dispatchTypes: ['http'],
      hosts: ['api.github.com'],
      tools: [],
      destinations: ['https://api.github.com'],
      methods: ['GET'],
      actions: ['issues.read'],
      pathPrefixes: ['/repos/'],
    },
    lease: {
      ttlSeconds: 60,
      maxUses: 1,
      renewable: false,
    },
    approval: 'not-required',
    ...overrides,
  };
}

function action(overrides: Partial<CredentialAction> = {}): CredentialAction {
  return {
    dispatchType: 'http',
    host: 'api.github.com',
    destination: 'https://api.github.com',
    method: 'GET',
    action: 'issues.read',
    path: '/repos/BradGroux/veritas-kanban/issues/931',
    argumentsDigest: ARGUMENTS_DIGEST,
    ...overrides,
  };
}

function runBinding(overrides: Partial<CredentialRunBinding> = {}): CredentialRunBinding {
  return {
    taskId: 'task_931',
    attemptId: 'attempt_931',
    status: 'running',
    runLaunchManifestDigest: MANIFEST_DIGEST,
    credentialReferences: ['github-token'],
    ...overrides,
  };
}

function createHarness(
  options: {
    now?: string;
    binding?: CredentialRunBinding | null;
    secret?: string;
    approve?: boolean;
    approvalId?: string | null;
  } = {}
) {
  let now = new Date(options.now ?? '2026-07-23T18:00:00.000Z');
  let binding = options.binding === undefined ? runBinding() : options.binding;
  let handleSequence = 0;
  const repository = new InMemoryCredentialBrokerRepository();
  const audit = vi.fn(async () => undefined);
  const secretSource = new EnvironmentCredentialSecretSource({
    VK_TEST_GITHUB_TOKEN: options.secret ?? SECRET,
  });
  const service = new CredentialBrokerService({
    repository,
    secretSources: [secretSource],
    runBindings: {
      read: vi.fn(async () => binding),
    },
    approvals: {
      verify: vi.fn(async ({ actionFingerprint }) => ({
        approved: options.approve === true,
        approvalId:
          options.approve === true
            ? options.approvalId === undefined
              ? 'approval_931'
              : (options.approvalId ?? undefined)
            : undefined,
        actionFingerprint,
      })),
    },
    audit,
    now: () => new Date(now),
    createHandle: () => {
      handleSequence++;
      return handleSequence === 1
        ? 'vkcred_test_handle_931'
        : `vkcred_test_handle_931_${handleSequence}`;
    },
  });

  return {
    service,
    repository,
    audit,
    setNow(value: string) {
      now = new Date(value);
    },
    setBinding(value: CredentialRunBinding | null) {
      binding = value;
    },
  };
}

async function createDefinition(service: CredentialBrokerService, input = definition()) {
  return service.createDefinition(input);
}

async function issueLease(service: CredentialBrokerService, credentialAction = action()) {
  return service.issueLease({
    definitionId: 'github-token',
    taskId: 'task_931',
    attemptId: 'attempt_931',
    runLaunchManifestDigest: MANIFEST_DIGEST,
    action: credentialAction,
  });
}

describe('CredentialBrokerService', () => {
  it('persists only versioned definition metadata and canonical digests', async () => {
    const { service, repository } = createHarness();

    const created = await createDefinition(service);
    const persisted = await repository.read();
    const serialized = JSON.stringify(persisted);

    expect(created.schemaVersion).toBe('credential-definition/v1');
    expect(created.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(created.source).toEqual({
      kind: 'environment',
      reference: 'VK_TEST_GITHUB_TOKEN',
    });
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('value');
    expect(created.scope).toEqual({
      dispatchTypes: ['http'],
      hosts: ['api.github.com'],
      tools: [],
      destinations: ['https://api.github.com'],
      methods: ['GET'],
      actions: ['issues.read'],
      pathPrefixes: ['/repos/'],
    });

    const unchanged = await service.updateDefinition('github-token', definition());
    expect(unchanged.digest).toBe(created.digest);

    const updated = await service.updateDefinition('github-token', {
      ...definition(),
      scope: {
        ...definition().scope,
        methods: ['POST', 'GET', 'GET'],
      },
    });
    expect(updated.digest).not.toBe(created.digest);
    expect(updated.scope.methods).toEqual(['GET', 'POST']);
  });

  it('issues an opaque manifest-bound lease and never persists the raw handle', async () => {
    const { service, repository } = createHarness();
    await createDefinition(service);

    const issued = await issueLease(service);
    const persisted = await repository.read();
    const serialized = JSON.stringify(persisted);

    expect(issued.handle).toBe('vkcred_test_handle_931');
    expect(issued.placeholder).toBe('{{vk-credential:vkcred_test_handle_931}}');
    expect(parseCredentialPlaceholder(issued.placeholder)).toBe(issued.handle);
    expect(issued.lease.schemaVersion).toBe('credential-lease/v1');
    expect(issued.lease.definitionId).toBe('github-token');
    expect(issued.lease.runLaunchManifestDigest).toBe(MANIFEST_DIGEST);
    expect(issued.lease.actionFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(issued.lease.handleHash).toBe(createHash('sha256').update(issued.handle).digest('hex'));
    expect(serialized).not.toContain(issued.handle);
    expect(serialized).not.toContain(issued.placeholder);
    expect(serialized).not.toContain(SECRET);
  });

  it('revokes a lease when its run binding terminates during issuance', async () => {
    const repository = new InMemoryCredentialBrokerRepository();
    let bindingReads = 0;
    const service = new CredentialBrokerService({
      repository,
      secretSources: [new EnvironmentCredentialSecretSource({ VK_TEST_GITHUB_TOKEN: SECRET })],
      runBindings: {
        read: async () => {
          bindingReads++;
          return runBinding({
            status: bindingReads === 1 ? 'running' : 'terminal',
          });
        },
      },
      now: () => new Date('2026-07-23T18:00:00.000Z'),
      createHandle: () => 'vkcred_test_issuance_race',
    });
    await createDefinition(service);

    await expect(issueLease(service)).rejects.toThrow(/stale/i);

    expect((await repository.read()).leases).toEqual([
      expect.objectContaining({
        state: 'revoked',
        terminalReason: 'run-binding-changed',
      }),
    ]);
  });

  it('resolves the value only inside the controlled callback and consumes the lease atomically', async () => {
    const { service, repository, audit } = createHarness();
    await createDefinition(service);
    const issued = await issueLease(service);
    const callbackResult = { status: 204 };
    const callerOperationId = `ghp_${'s'.repeat(36)}`;
    const dispatch = vi.fn(async (value: string) => {
      expect(value).toBe(SECRET);
      return callbackResult;
    });

    const result = await service.withCredential(
      {
        handle: issued.handle,
        operationId: callerOperationId,
        taskId: 'task_931',
        attemptId: 'attempt_931',
        runLaunchManifestDigest: MANIFEST_DIGEST,
        action: action(),
      },
      dispatch
    );

    expect(result).toEqual({ status: 204 });
    expect(result).not.toBe(callbackResult);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const persisted = await repository.read();
    const lease = persisted.leases[0];
    expect(lease.uses).toBe(1);
    expect(lease.state).toBe('exhausted');
    expect(lease.operations[0].id).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(persisted)).not.toContain(callerOperationId);
    expect(JSON.stringify(persisted)).not.toContain(SECRET);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'use',
        taskId: 'task_931',
        decision: 'allowed',
        operationId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      })
    );

    await expect(
      service.withCredential(
        {
          handle: issued.handle,
          operationId: 'use_exhausted_retry',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        dispatch
      )
    ).rejects.toThrow(/exhausted/i);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('blocks a callback from returning or throwing the credential value', async () => {
    const { service } = createHarness();
    await createDefinition(service, {
      ...definition(),
      lease: { ttlSeconds: 60, maxUses: 2, renewable: false },
    });
    const first = await issueLease(service);

    await expect(
      service.withCredential(
        {
          handle: first.handle,
          operationId: 'use_object_leak',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async (value) => ({ authorization: `Bearer ${value}` })
      )
    ).rejects.toThrow(/returned credential material/i);

    const secondHarness = createHarness();
    await createDefinition(secondHarness.service);
    const second = await issueLease(secondHarness.service);
    let caught: unknown;
    try {
      await secondHarness.service.withCredential(
        {
          handle: second.handle,
          operationId: 'use_error_leak',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async (value) => {
          throw new Error(`dispatch failed with ${value}`);
        }
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/controlled credential dispatch failed/i);
    expect((caught as Error).message).not.toContain(SECRET);

    const binaryHarness = createHarness();
    await createDefinition(binaryHarness.service);
    const binary = await issueLease(binaryHarness.service);
    await expect(
      binaryHarness.service.withCredential(
        {
          handle: binary.handle,
          operationId: 'use_binary_leak',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async (value) => Buffer.from(value)
      )
    ).rejects.toThrow(/returned credential material/i);

    const binarySliceHarness = createHarness();
    await createDefinition(binarySliceHarness.service);
    const binarySliceLease = await issueLease(binarySliceHarness.service);
    await expect(
      binarySliceHarness.service.withCredential(
        {
          handle: binarySliceLease.handle,
          operationId: 'use_binary_slice',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async (value) => {
          const backing = Buffer.concat([Buffer.from(value), Buffer.from('visible')]);
          return backing.subarray(Buffer.byteLength(value));
        }
      )
    ).rejects.toThrow(/returned credential material/i);

    const urlHarness = createHarness();
    await createDefinition(urlHarness.service);
    const urlLease = await issueLease(urlHarness.service);
    await expect(
      urlHarness.service.withCredential(
        {
          handle: urlLease.handle,
          operationId: 'use_url_leak',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async (value) => new URL(`https://example.invalid/?token=${encodeURIComponent(value)}`)
      )
    ).rejects.toThrow(/returned credential material/i);

    const accessorHarness = createHarness();
    await createDefinition(accessorHarness.service);
    const accessorLease = await issueLease(accessorHarness.service);
    await expect(
      accessorHarness.service.withCredential(
        {
          handle: accessorLease.handle,
          operationId: 'use_accessor_leak',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async (value) =>
          Object.defineProperty({}, 'authorization', {
            enumerable: false,
            get: () => `Bearer ${value}`,
          })
      )
    ).rejects.toThrow(/returned credential material/i);

    const nestedHarness = createHarness();
    await createDefinition(nestedHarness.service);
    const nestedLease = await issueLease(nestedHarness.service);
    let nestedResult: unknown = SECRET;
    for (let depth = 0; depth < 12; depth++) nestedResult = { next: nestedResult };
    await expect(
      nestedHarness.service.withCredential(
        {
          handle: nestedLease.handle,
          operationId: 'use_nested_leak',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async () => nestedResult
      )
    ).rejects.toThrow(/returned credential material/i);

    const proxyHarness = createHarness();
    await createDefinition(proxyHarness.service);
    const proxyLease = await issueLease(proxyHarness.service);
    let proxyError: unknown;
    try {
      await proxyHarness.service.withCredential(
        {
          handle: proxyLease.handle,
          operationId: 'use_proxy_leak',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async (value) =>
          new Proxy(
            {},
            {
              ownKeys() {
                throw new Error(`proxy inspection failed with ${value}`);
              },
            }
          )
      );
    } catch (error) {
      proxyError = error;
    }
    expect(proxyError).toBeInstanceOf(Error);
    expect((proxyError as Error).message).toMatch(/returned credential material/i);
    expect((proxyError as Error).message).not.toContain(SECRET);

    const hiddenProxyHarness = createHarness();
    await createDefinition(hiddenProxyHarness.service);
    const hiddenProxyLease = await issueLease(hiddenProxyHarness.service);
    await expect(
      hiddenProxyHarness.service.withCredential(
        {
          handle: hiddenProxyLease.handle,
          operationId: 'use_hidden_proxy_leak',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async (value) =>
          new Proxy(
            {},
            {
              getPrototypeOf: () => Object.prototype,
              ownKeys: () => [],
              getOwnPropertyDescriptor: () => undefined,
              get: (_target, property) =>
                property === 'credential' ? () => value : Reflect.get({}, property),
            }
          )
      )
    ).rejects.toThrow(/returned credential material/i);

    const subclassHarness = createHarness();
    await createDefinition(subclassHarness.service);
    const subclassLease = await issueLease(subclassHarness.service);
    await expect(
      subclassHarness.service.withCredential(
        {
          handle: subclassLease.handle,
          operationId: 'use_subclass_leak',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async (value) => {
          class CredentialDate extends Date {
            get credential() {
              return value;
            }
          }
          return new CredentialDate('2026-07-23T18:00:00.000Z');
        }
      )
    ).rejects.toThrow(/returned credential material/i);
  });

  it('fails closed for stale run bindings, changed actions, missing sources, and ambiguous placeholders', async () => {
    const stale = createHarness({
      binding: runBinding({ runLaunchManifestDigest: `sha256:${'c'.repeat(64)}` }),
    });
    await createDefinition(stale.service);
    await expect(issueLease(stale.service)).rejects.toThrow(/manifest/i);

    const undeclared = createHarness({
      binding: runBinding({ credentialReferences: ['another-credential'] }),
    });
    await createDefinition(undeclared.service);
    await expect(issueLease(undeclared.service)).rejects.toThrow(/not declared/i);

    const redactedCollision = createHarness({
      binding: runBinding({ credentialReferences: ['github-token=[redacted]'] }),
    });
    await createDefinition(redactedCollision.service);
    await expect(issueLease(redactedCollision.service)).rejects.toThrow(/not declared/i);

    const changed = createHarness();
    await createDefinition(changed.service);
    const issued = await issueLease(changed.service);
    await expect(
      changed.service.withCredential(
        {
          handle: issued.handle,
          operationId: 'use_changed_action',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action({ method: 'POST' }),
        },
        async () => ({ ok: true })
      )
    ).rejects.toThrow(/action/i);
    await expect(
      issueLease(
        changed.service,
        action({
          destination: 'https://attacker.example',
        })
      )
    ).rejects.toThrow(/host.*destination/i);

    const missingSource = createHarness({ secret: '' });
    await createDefinition(missingSource.service);
    const missingSourceLease = await issueLease(missingSource.service);
    await expect(
      missingSource.service.withCredential(
        {
          handle: missingSourceLease.handle,
          operationId: 'use_missing_source',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async () => ({ ok: true })
      )
    ).rejects.toThrow(/source/i);

    expect(() =>
      parseCredentialPlaceholder('{{vk-credential:vkcred_one}} {{vk-credential:vkcred_two}}')
    ).toThrow(/ambiguous/i);
  });

  it('canonicalizes HTTP paths before enforcing path-prefix scope', async () => {
    const harness = createHarness();
    await createDefinition(harness.service, {
      ...definition(),
      scope: {
        ...definition().scope,
        pathPrefixes: ['/repos/BradGroux/veritas-kanban/issues/'],
      },
    });

    await expect(
      issueLease(
        harness.service,
        action({
          path: '/repos/BradGroux/veritas-kanban/issues/../pulls/931',
        })
      )
    ).rejects.toThrow(/path/i);
    await expect(
      issueLease(
        harness.service,
        action({
          path: '/repos/BradGroux/veritas-kanban/issues/%2e%2e/pulls/931',
        })
      )
    ).rejects.toThrow(/path/i);
    await expect(
      issueLease(
        harness.service,
        action({
          path: '/repos/BradGroux/veritas-kanban/issues%2f931',
        })
      )
    ).rejects.toThrow(/encoded path separator/i);
  });

  it.each(['tool', 'mcp'] as const)(
    'enforces exact tool and action scope for %s dispatch',
    async (dispatchType) => {
      const harness = createHarness();
      await createDefinition(harness.service, {
        ...definition(),
        scope: {
          dispatchTypes: [dispatchType],
          hosts: [],
          tools: ['github'],
          destinations: [],
          methods: [],
          actions: ['issues.read'],
          pathPrefixes: [],
        },
      });
      const toolAction: CredentialAction = {
        dispatchType,
        tool: 'github',
        action: 'issues.read',
        argumentsDigest: ARGUMENTS_DIGEST,
      };

      await expect(issueLease(harness.service, toolAction)).resolves.toMatchObject({
        lease: { state: 'active' },
      });

      const denied = createHarness();
      await createDefinition(denied.service, {
        ...definition(),
        scope: {
          dispatchTypes: [dispatchType],
          hosts: [],
          tools: ['github'],
          destinations: [],
          methods: [],
          actions: ['issues.read'],
          pathPrefixes: [],
        },
      });
      await expect(
        issueLease(denied.service, {
          ...toolAction,
          tool: 'shell',
        })
      ).rejects.toThrow(/tool/i);
      await expect(
        issueLease(denied.service, {
          ...toolAction,
          action: 'issues.write',
        })
      ).rejects.toThrow(/action/i);
    }
  );

  it('requires a correlated approval for definitions that declare approval-gated use', async () => {
    const denied = createHarness();
    await createDefinition(denied.service, {
      ...definition(),
      approval: 'required',
    });
    await expect(issueLease(denied.service)).rejects.toThrow(/approval/i);

    const approved = createHarness({ approve: true });
    await createDefinition(approved.service, {
      ...definition(),
      approval: 'required',
    });
    const issued = await issueLease(approved.service);
    expect(issued.lease.approvalId).toBe('approval_931');

    const missingCorrelation = createHarness({ approve: true, approvalId: null });
    await createDefinition(missingCorrelation.service, {
      ...definition(),
      approval: 'required',
    });
    await expect(issueLease(missingCorrelation.service)).rejects.toThrow(/correlated approval/i);
  });

  it('records metadata-only audit evidence for issuance denials', async () => {
    const harness = createHarness();
    await createDefinition(harness.service);

    await expect(issueLease(harness.service, action({ method: 'POST' }))).rejects.toThrow(
      /method/i
    );

    expect((await harness.repository.read()).auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'denial',
          decision: 'denied',
          definitionId: 'github-token',
          definitionDigest: expect.stringMatching(/^sha256:/),
          scopeDigest: expect.stringMatching(/^sha256:/),
          actionFingerprint: expect.stringMatching(/^sha256:/),
          taskId: 'task_931',
          attemptId: 'attempt_931',
          reason: 'action-outside-scope',
        }),
      ])
    );
    expect(JSON.stringify(await harness.repository.read())).not.toContain(SECRET);
  });

  it('expires, revokes, and reconciles leases without a server restart', async () => {
    const harness = createHarness();
    await createDefinition(harness.service, {
      ...definition(),
      lease: { ttlSeconds: 10, maxUses: 3, renewable: true },
    });
    const expired = await issueLease(harness.service);
    harness.setNow('2026-07-23T18:00:11.000Z');
    await expect(
      harness.service.withCredential(
        {
          handle: expired.handle,
          operationId: 'use_expired',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async () => ({ ok: true })
      )
    ).rejects.toThrow(/expired/i);

    harness.setNow('2026-07-23T18:00:12.000Z');
    const runLease = await issueLease(harness.service);
    expect(
      await harness.service.revokeRun({
        taskId: 'task_931',
        attemptId: 'attempt_931',
        runLaunchManifestDigest: MANIFEST_DIGEST,
        reason: 'run-completed',
      })
    ).toBe(1);
    await expect(
      harness.service.withCredential(
        {
          handle: runLease.handle,
          operationId: 'use_revoked',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        async () => ({ ok: true })
      )
    ).rejects.toThrow(/revoked/i);

    harness.setBinding(null);
    const reconciliation = await harness.service.reconcile();
    expect(reconciliation).toEqual(
      expect.objectContaining({
        active: 0,
        revoked: expect.any(Number),
        expired: expect.any(Number),
      })
    );
  });

  it('blocks active leases during reconciliation when the source is unavailable', async () => {
    const harness = createHarness({ secret: '' });
    await createDefinition(harness.service);
    await issueLease(harness.service);

    const reconciliation = await harness.service.reconcile();

    expect(reconciliation.blocked).toBe(1);
    expect((await harness.repository.read()).leases[0]).toMatchObject({
      state: 'blocked',
      terminalReason: 'source-unavailable',
    });
  });

  it('does not overwrite a newer terminal transition when source resolution fails', async () => {
    const repository = new InMemoryCredentialBrokerRepository();
    let releaseResolution: (() => void) | undefined;
    let markResolutionStarted: (() => void) | undefined;
    const resolutionStarted = new Promise<void>((resolve) => {
      markResolutionStarted = resolve;
    });
    const resolutionGate = new Promise<void>((resolve) => {
      releaseResolution = resolve;
    });
    const service = new CredentialBrokerService({
      repository,
      secretSources: [
        {
          supports: () => true,
          isAvailable: async () => true,
          resolve: async () => {
            markResolutionStarted?.();
            await resolutionGate;
            return undefined;
          },
        },
      ],
      runBindings: { read: async () => runBinding() },
      now: () => new Date('2026-07-23T18:00:00.000Z'),
      createHandle: () => 'vkcred_source_resolution_race',
    });
    await createDefinition(service);
    const issued = await issueLease(service);
    const dispatch = service.withCredential(
      {
        handle: issued.handle,
        operationId: 'use_source_resolution_race',
        taskId: 'task_931',
        attemptId: 'attempt_931',
        runLaunchManifestDigest: MANIFEST_DIGEST,
        action: action(),
      },
      async () => ({ ok: true })
    );
    await resolutionStarted;
    await service.revokeRun({
      taskId: 'task_931',
      attemptId: 'attempt_931',
      reason: 'run-completed',
    });
    releaseResolution?.();

    await expect(dispatch).rejects.toThrow(/source/i);
    expect((await repository.read()).leases[0]).toMatchObject({
      state: 'revoked',
      terminalReason: 'run-completed',
    });
  });

  it('probes external state before opening the reconciliation transaction', async () => {
    const backingRepository = new InMemoryCredentialBrokerRepository();
    let inTransaction = false;
    let sourceObservedTransaction = false;
    let bindingObservedTransaction = false;
    const repository: CredentialBrokerRepository = {
      read: () => backingRepository.read(),
      transact: (mutate) =>
        backingRepository.transact(async (state) => {
          inTransaction = true;
          try {
            return await mutate(state);
          } finally {
            inTransaction = false;
          }
        }),
    };
    const service = new CredentialBrokerService({
      repository,
      secretSources: [
        {
          supports: () => true,
          isAvailable: async () => {
            sourceObservedTransaction = inTransaction;
            return true;
          },
          resolve: async () => SECRET,
        },
      ],
      runBindings: {
        read: async () => {
          bindingObservedTransaction = inTransaction;
          return runBinding();
        },
      },
      now: () => new Date('2026-07-23T18:00:00.000Z'),
      createHandle: () => 'vkcred_test_reconcile_handle',
    });
    await createDefinition(service);
    await issueLease(service);

    const reconciliation = await service.reconcile();

    expect(reconciliation.active).toBe(1);
    expect(sourceObservedTransaction).toBe(false);
    expect(bindingObservedTransaction).toBe(false);
  });

  it('allows only one concurrent dispatch to claim a single-use lease', async () => {
    const { service } = createHarness();
    await createDefinition(service);
    const issued = await issueLease(service);
    const dispatch = vi.fn(async () => ({ ok: true }));

    const results = await Promise.allSettled([
      service.withCredential(
        {
          handle: issued.handle,
          operationId: 'use_concurrent_one',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        dispatch
      ),
      service.withCredential(
        {
          handle: issued.handle,
          operationId: 'use_concurrent_two',
          taskId: 'task_931',
          attemptId: 'attempt_931',
          runLaunchManifestDigest: MANIFEST_DIGEST,
          action: action(),
        },
        dispatch
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('fails closed on duplicate use and refresh operation IDs without replaying transitions', async () => {
    const harness = createHarness();
    await createDefinition(harness.service, {
      ...definition(),
      lease: { ttlSeconds: 10, maxUses: 3, renewable: true },
    });
    const issued = await issueLease(harness.service);
    const dispatch = vi.fn(async () => ({ ok: true }));
    const request = {
      handle: issued.handle,
      operationId: 'operation_retry_931',
      taskId: 'task_931',
      attemptId: 'attempt_931',
      runLaunchManifestDigest: MANIFEST_DIGEST,
      action: action(),
    };

    await expect(harness.service.withCredential(request, dispatch)).resolves.toEqual({
      ok: true,
    });
    await expect(harness.service.withCredential(request, dispatch)).rejects.toThrow(
      /already claimed/i
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((await harness.repository.read()).leases[0].uses).toBe(1);

    harness.setNow('2026-07-23T18:00:05.000Z');
    const refreshed = await harness.service.refreshLease({
      ...request,
      operationId: 'refresh_retry_931',
    });
    expect(refreshed.expiresAt).toBe('2026-07-23T18:00:15.000Z');
    harness.setNow('2026-07-23T18:00:06.000Z');
    await expect(
      harness.service.refreshLease({
        ...request,
        operationId: 'refresh_retry_931',
      })
    ).rejects.toThrow(/already claimed/i);
    expect((await harness.repository.read()).leases[0].expiresAt).toBe('2026-07-23T18:00:15.000Z');
  });

  it('refreshes renewable active leases but never resurrects an expired lease', async () => {
    const harness = createHarness();
    await createDefinition(harness.service, {
      ...definition(),
      lease: { ttlSeconds: 10, maxUses: 3, renewable: true },
    });
    const issued = await issueLease(harness.service);

    harness.setNow('2026-07-23T18:00:05.000Z');
    const refreshed = await harness.service.refreshLease({
      handle: issued.handle,
      operationId: 'refresh_primary',
      taskId: 'task_931',
      attemptId: 'attempt_931',
      runLaunchManifestDigest: MANIFEST_DIGEST,
      action: action(),
    });
    expect(refreshed.expiresAt).toBe('2026-07-23T18:00:15.000Z');

    harness.setNow('2026-07-23T18:00:16.000Z');
    await expect(
      harness.service.refreshLease({
        handle: issued.handle,
        operationId: 'refresh_after_expiry',
        taskId: 'task_931',
        attemptId: 'attempt_931',
        runLaunchManifestDigest: MANIFEST_DIGEST,
        action: action(),
      })
    ).rejects.toThrow(/expired/i);
  });

  it('atomically persists metadata without writing the handle or source value to disk', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'vk-credential-broker-'));
    const statePath = path.join(directory, 'state.json');
    try {
      const service = new CredentialBrokerService({
        repository: new FileCredentialBrokerRepository({ statePath }),
        secretSources: [
          new EnvironmentCredentialSecretSource({
            VK_TEST_GITHUB_TOKEN: SECRET,
          }),
        ],
        runBindings: { read: async () => runBinding() },
        audit: async () => undefined,
        now: () => new Date('2026-07-23T18:00:00.000Z'),
        createHandle: () => 'vkcred_file_repository_handle',
      });
      await createDefinition(service);
      const issued = await issueLease(service);
      const persisted = await readFile(statePath, 'utf8');

      expect(persisted).not.toContain(SECRET);
      expect(persisted).not.toContain(issued.handle);
      expect(persisted).not.toContain(issued.placeholder);
      expect(persisted).toContain(issued.lease.handleHash);
      expect(JSON.parse(persisted)).toMatchObject({
        schemaVersion: 'credential-broker-state/v1',
        revision: 2,
      });
      expect((await readdir(directory)).filter((name) => name.includes('.candidate'))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed on unverifiable broker lock ownership until an operator clears it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'vk-credential-broker-lock-'));
    const statePath = path.join(directory, 'state.json');
    const lockPath = `${statePath}.lock`;
    try {
      await writeFile(
        lockPath,
        JSON.stringify({
          pid: 999_999,
          createdAt: '2026-07-23T18:00:00.000Z',
          token: 'a'.repeat(48),
        })
      );
      const service = new CredentialBrokerService({
        repository: new FileCredentialBrokerRepository({ statePath, lockTimeoutMs: 25 }),
        secretSources: [],
        runBindings: { read: async () => runBinding() },
      });

      await expect(createDefinition(service)).rejects.toThrow(/lock is held or stale/i);
      expect(await readFile(lockPath, 'utf8')).toContain('999999');

      await unlink(lockPath);
      await expect(createDefinition(service)).resolves.toMatchObject({ id: 'github-token' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
