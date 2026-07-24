import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type VerifiedEvent } from 'nostr-tools';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigService } from '../services/config-service.js';
import { AgentProfilePackageService } from '../services/agent-profile-package-service.js';
import { TeamRosterService } from '../services/team-roster-service.js';
import { BuzzDefinitionImportService } from '../services/buzz-definition-import-service.js';
import type { BuzzQueryContext } from '../services/communication-adapter-service.js';

const now = Math.floor(Date.now() / 1_000) - 10;
const context: BuzzQueryContext = {
  relay: 'https://buzz.example.com',
  community: 'buzz.example.com',
  probeConfig: {
    enabled: true,
    relayHttpUrl: 'https://buzz.example.com',
    publicKey: 'a'.repeat(64),
    credentialRef: 'env:BUZZ_PRIVATE_KEY',
  },
};

function definitionEvent(
  secretKey: Uint8Array,
  kind: 30_175 | 30_176,
  dTag: string,
  content: Record<string, unknown>,
  createdAt = now
): VerifiedEvent {
  return finalizeEvent(
    {
      kind,
      created_at: createdAt,
      tags: [['d', dTag]],
      content: JSON.stringify(content),
    },
    secretKey
  );
}

describe('BuzzDefinitionImportService', () => {
  let runtimeDir: string;
  let configService: ConfigService;
  let profiles: AgentProfilePackageService;
  let rosters: TeamRosterService;
  let events: VerifiedEvent[];
  let service: BuzzDefinitionImportService;
  let secretKey: Uint8Array;
  let author: string;
  const audit = vi.fn(async () => undefined);

  beforeEach(async () => {
    runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'vk-buzz-definitions-'));
    configService = new ConfigService({ configDir: runtimeDir, storageType: 'file' });
    profiles = new AgentProfilePackageService(configService);
    rosters = new TeamRosterService(configService);
    secretKey = generateSecretKey();
    author = getPublicKey(secretKey);
    events = [];
    audit.mockClear();
    service = new BuzzDefinitionImportService({
      communicationAdapters: {
        getBuzzQueryContext: vi.fn(async () => context),
      },
      buzzCommunication: {
        queryEvents: vi.fn(async () => events),
      },
      profiles,
      rosters,
      audit,
      now: () => new Date(now * 1_000),
    });
  });

  afterEach(async () => {
    configService.dispose();
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it('selects deterministic NIP-33 heads and reports forward-compatible fields', async () => {
    const older = definitionEvent(
      secretKey,
      30_175,
      'reviewer',
      { display_name: 'Old Reviewer' },
      now - 10
    );
    const candidates = [
      definitionEvent(
        secretKey,
        30_175,
        'reviewer',
        { display_name: 'Reviewer B', future_field: 'retained nowhere' },
        now
      ),
      definitionEvent(
        secretKey,
        30_175,
        'reviewer',
        { display_name: 'Reviewer A', future_field: 'retained nowhere' },
        now
      ),
    ];
    events = [older, ...candidates];

    const result = await service.listDefinitions('buzz-default');
    const expectedHead = [...candidates].sort((left, right) => left.id.localeCompare(right.id))[0];

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]?.eventId).toBe(expectedHead?.id);
    const preview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: author, kind: 30_175, dTag: 'reviewer' },
      action: 'create',
    });
    expect(preview.fieldReport).toContainEqual(
      expect.objectContaining({ field: 'future_field', disposition: 'ignored' })
    );
    expect(preview.diff).toContainEqual(
      expect.objectContaining({ field: 'displayName', change: 'add' })
    );
  });

  it('creates a disabled persona profile without activating source runtime preferences', async () => {
    events = [
      definitionEvent(secretKey, 30_175, 'security-reviewer', {
        display_name: 'Security Reviewer',
        system_prompt: 'Review security boundaries.',
        runtime: 'container',
        model: 'source-model',
        provider: 'source-provider',
        avatar_url: 'https://cdn.example.com/avatar.png',
        name_pool: ['ALPHA'],
        respond_to: 'mentions',
      }),
    ];
    const preview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: author, kind: 30_175, dTag: 'security-reviewer' },
      action: 'create',
    });
    const result = await service.importDefinition(
      'buzz-default',
      {
        coordinate: preview.definition,
        action: 'create',
        targetId: preview.targetId,
        expectedEventId: preview.definition.eventId,
        expectedLocalRevision: preview.expectedLocalRevision,
      },
      'test-admin'
    );

    expect(result.status).toBe('created');
    expect(result.profile).toMatchObject({
      id: 'buzz-security-reviewer',
      displayName: 'Security Reviewer',
      enabled: false,
      instructions: { prompt: 'Review security boundaries.' },
    });
    expect(result.profile?.runtime).toEqual({ agent: 'buzz-security-reviewer' });
    expect(result.profile?.metadata?.buzz?.sourceSnapshot).toMatchObject({
      runtime: 'container',
      model: 'source-model',
      provider: 'source-provider',
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'buzz_definition.created', actor: 'test-admin' })
    );
    expect(
      profiles.validateContent({
        content: JSON.stringify(result.profile),
        format: 'json',
      })
    ).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ path: '$.metadata.buzz' })],
    });

    if (!result.profile) throw new Error('Expected imported profile');
    const nativeReplacement = structuredClone(result.profile);
    delete nativeReplacement.metadata?.buzz;
    nativeReplacement.role = 'Locally replaced role';
    await profiles.importProfile({
      content: JSON.stringify(nativeReplacement),
      format: 'json',
    });
    expect(await profiles.getProfile(nativeReplacement.id)).toMatchObject({
      role: 'Locally replaced role',
      metadata: { buzz: expect.objectContaining({ provenance: expect.any(Object) }) },
    });
  });

  it('imports teams only through same-author linked persona profiles and keeps routing disabled', async () => {
    const persona = definitionEvent(secretKey, 30_175, 'builder', {
      display_name: 'Builder',
    });
    const team = definitionEvent(secretKey, 30_176, 'delivery-team', {
      name: 'Delivery Team',
      description: 'A public Buzz team definition.',
      persona_ids: ['builder'],
    });
    events = [persona, team];
    const personaPreview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: author, kind: 30_175, dTag: 'builder' },
      action: 'create',
    });
    await service.importDefinition('buzz-default', {
      coordinate: personaPreview.definition,
      action: 'create',
      expectedEventId: personaPreview.definition.eventId,
    });
    const teamPreview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: author, kind: 30_176, dTag: 'delivery-team' },
      action: 'create',
    });
    const result = await service.importDefinition('buzz-default', {
      coordinate: teamPreview.definition,
      action: 'create',
      expectedEventId: teamPreview.definition.eventId,
      expectedLocalRevision: teamPreview.expectedLocalRevision,
    });

    expect(result.roster).toMatchObject({
      name: 'Delivery Team',
      enabled: false,
      routingRules: [],
      members: [
        {
          id: 'buzz-builder',
          profileId: 'buzz-builder',
          status: 'disabled',
        },
      ],
    });
    if (!result.roster) throw new Error('Expected imported roster');
    const nativeRosterUpdate = structuredClone(result.roster);
    delete nativeRosterUpdate.metadata?.buzz;
    nativeRosterUpdate.description = 'Local roster description';
    const saved = await rosters.saveRoster(nativeRosterUpdate);
    expect(saved).toMatchObject({
      description: 'Local roster description',
      metadata: { buzz: expect.objectContaining({ provenance: expect.any(Object) }) },
    });
  });

  it('does not resolve a team persona through a different author link', async () => {
    const otherSecretKey = generateSecretKey();
    const otherAuthor = getPublicKey(otherSecretKey);
    const otherPersona = definitionEvent(otherSecretKey, 30_175, 'builder', {
      display_name: 'Other Builder',
    });
    const team = definitionEvent(secretKey, 30_176, 'delivery-team', {
      name: 'Delivery Team',
      persona_ids: ['builder'],
    });
    events = [otherPersona, team];
    const personaPreview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: otherAuthor, kind: 30_175, dTag: 'builder' },
      action: 'create',
    });
    await service.importDefinition('buzz-default', {
      coordinate: personaPreview.definition,
      action: 'create',
      expectedEventId: personaPreview.definition.eventId,
    });

    const teamPreview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: author, kind: 30_176, dTag: 'delivery-team' },
      action: 'create',
    });
    expect(teamPreview.unresolvedPersonaIds).toEqual(['builder']);
    expect(teamPreview.proposedRoster?.members).toEqual([]);
  });

  it('rejects secret-like and managed runtime material before preview', async () => {
    events = [
      definitionEvent(secretKey, 30_175, 'unsafe', {
        display_name: 'Unsafe',
        command: 'buzz-agent --token=topsecretvalue',
      }),
      definitionEvent(secretKey, 30_175, 'unsafe-secret', {
        display_name: 'Unsafe Secret',
        system_prompt: 'token=topsecretvalue',
      }),
    ];

    const result = await service.listDefinitions('buzz-default');
    expect(result.definitions).toEqual([
      expect.objectContaining({ compatibility: 'rejected' }),
      expect.objectContaining({ compatibility: 'rejected' }),
    ]);
    expect(result.rejectedCount).toBe(2);
  });

  it('does not fall back to an older valid definition when the current head is rejected', async () => {
    events = [
      definitionEvent(
        secretKey,
        30_175,
        'reviewer',
        { display_name: 'Older valid reviewer' },
        now - 1
      ),
      definitionEvent(
        secretKey,
        30_175,
        'reviewer',
        { display_name: 'Rejected current reviewer', environment: { TOKEN: 'value' } },
        now
      ),
    ];

    const result = await service.listDefinitions('buzz-default');
    expect(result.definitions).toEqual([
      expect.objectContaining({
        dTag: 'reviewer',
        compatibility: 'rejected',
        displayName: 'Persona reviewer',
      }),
    ]);
    const preview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: author, kind: 30_175, dTag: 'reviewer' },
      action: 'create',
    });
    expect(preview.fieldReport).toEqual([
      expect.objectContaining({ field: '$', disposition: 'rejected' }),
    ]);
    await expect(
      service.importDefinition('buzz-default', {
        coordinate: preview.definition,
        action: 'create',
        expectedEventId: preview.definition.eventId,
      })
    ).rejects.toThrow('failed validation');
  });

  it('bounds unsafe URLs, traversal slugs, JSON depth, and array counts', async () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let index = 0; index < 12; index += 1) deep = { nested: deep };
    events = [
      definitionEvent(secretKey, 30_175, 'unsafe-url', {
        display_name: 'Unsafe URL',
        avatar_url: 'http://127.0.0.1/private',
      }),
      definitionEvent(secretKey, 30_175, '../traversal', {
        display_name: 'Traversal',
      }),
      definitionEvent(secretKey, 30_175, 'too-deep', {
        display_name: 'Too Deep',
        future: deep,
      }),
      definitionEvent(secretKey, 30_175, 'too-many', {
        display_name: 'Too Many',
        future: Array.from({ length: 201 }, (_, index) => index),
      }),
    ];

    const result = await service.listDefinitions('buzz-default');
    expect(result.rejectedCount).toBe(4);
    expect(result.definitions).toHaveLength(3);
    expect(result.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dTag: 'unsafe-url', compatibility: 'rejected' }),
        expect.objectContaining({ dTag: 'too-deep', compatibility: 'rejected' }),
        expect.objectContaining({ dTag: 'too-many', compatibility: 'rejected' }),
      ])
    );
  });

  it('rejects a stale optimistic revision and leaves local edits intact', async () => {
    events = [
      definitionEvent(secretKey, 30_175, 'reviewer', {
        display_name: 'Reviewer',
        system_prompt: 'Initial instructions.',
      }),
    ];
    const createPreview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: author, kind: 30_175, dTag: 'reviewer' },
      action: 'create',
    });
    await service.importDefinition('buzz-default', {
      coordinate: createPreview.definition,
      action: 'create',
      expectedEventId: createPreview.definition.eventId,
    });
    events = [
      definitionEvent(
        secretKey,
        30_175,
        'reviewer',
        { display_name: 'Updated Reviewer', system_prompt: 'Updated instructions.' },
        now + 1
      ),
    ];
    const refreshPreview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: author, kind: 30_175, dTag: 'reviewer' },
      action: 'refresh',
    });
    await profiles.updateProfile('buzz-reviewer', { role: 'Locally edited role' });

    await expect(
      service.importDefinition('buzz-default', {
        coordinate: refreshPreview.definition,
        action: 'refresh',
        targetId: refreshPreview.targetId,
        expectedEventId: refreshPreview.definition.eventId,
        expectedLocalRevision: refreshPreview.expectedLocalRevision,
      })
    ).rejects.toThrow('changed after preview');
    expect(await profiles.getProfile('buzz-reviewer')).toMatchObject({
      displayName: 'Reviewer',
      role: 'Locally edited role',
    });
  });

  it('returns unchanged for an idempotent explicit refresh', async () => {
    events = [
      definitionEvent(secretKey, 30_175, 'reviewer', {
        display_name: 'Reviewer',
      }),
    ];
    const createPreview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: author, kind: 30_175, dTag: 'reviewer' },
      action: 'create',
    });
    await service.importDefinition('buzz-default', {
      coordinate: createPreview.definition,
      action: 'create',
      expectedEventId: createPreview.definition.eventId,
    });
    const refreshPreview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: author, kind: 30_175, dTag: 'reviewer' },
      action: 'refresh',
    });
    const result = await service.importDefinition('buzz-default', {
      coordinate: refreshPreview.definition,
      action: 'refresh',
      targetId: refreshPreview.targetId,
      expectedEventId: refreshPreview.definition.eventId,
      expectedLocalRevision: refreshPreview.expectedLocalRevision,
    });

    expect(result.status).toBe('unchanged');
  });

  it('reports missing and changed linked sources without deleting materialized profiles', async () => {
    const original = definitionEvent(secretKey, 30_175, 'reviewer', {
      display_name: 'Reviewer',
    });
    events = [original];
    const preview = await service.preview('buzz-default', {
      coordinate: { authorPubkey: author, kind: 30_175, dTag: 'reviewer' },
      action: 'create',
    });
    await service.importDefinition('buzz-default', {
      coordinate: preview.definition,
      action: 'create',
      expectedEventId: preview.definition.eventId,
    });
    events = [
      definitionEvent(secretKey, 30_175, 'reviewer', { display_name: 'Reviewer 2' }, now + 1),
    ];
    expect(await service.linkedStatus('buzz-default')).toMatchObject([
      { targetId: 'buzz-reviewer', status: 'changed', linkedEventId: original.id },
    ]);
    events = [];
    expect(await service.linkedStatus('buzz-default')).toMatchObject([
      { targetId: 'buzz-reviewer', status: 'missing' },
    ]);
    expect(await profiles.getProfile('buzz-reviewer')).not.toBeNull();
  });
});
