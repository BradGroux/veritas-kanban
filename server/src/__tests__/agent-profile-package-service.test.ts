import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ConfigService } from '../services/config-service.js';
import { AgentProfilePackageService } from '../services/agent-profile-package-service.js';

const PROFILE_YAML = `id: release-reviewer
schemaVersion: agent-profile-package/v1
version: 1.0.0
displayName: Release Reviewer
role: Reviews release tasks before publication
enabled: true
capabilities:
  - release
  - qa
defaultTaskTypes:
  - review
runtime:
  agent: codex
  provider: codex-cli
  model: gpt-5.1
instructions:
  prompt: Verify release notes against shipped behavior.
tools:
  allowed:
    - shell
    - git
permissions:
  level: specialist
policy:
  sandboxPresetId: workspace-write-default
  budget:
    enabled: true
    scope: run
    limits:
      totalTokens: 50000
    hardAction: require-approval
`;

describe('AgentProfilePackageService', () => {
  let tmpDir: string;
  let configService: ConfigService;
  let service: AgentProfilePackageService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-agent-profiles-'));
    configService = new ConfigService({
      configDir: tmpDir,
      configFile: path.join(tmpDir, 'config.json'),
    });
    service = new AgentProfilePackageService(configService);
  });

  afterEach(async () => {
    configService.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('validates YAML packages with actionable field paths', () => {
    const valid = service.validateContent({ content: PROFILE_YAML, format: 'yaml' });
    expect(valid.valid).toBe(true);
    expect(valid.profile).toMatchObject({
      id: 'release-reviewer',
      runtime: { agent: 'codex', model: 'gpt-5.1' },
      policy: { sandboxPresetId: 'workspace-write-default' },
    });

    const invalid = service.validateContent({
      content: 'displayName: Missing Runtime',
      format: 'yaml',
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.path)).toContain('$.id');
    expect(invalid.issues.map((issue) => issue.path)).toContain('$.runtime');
  });

  it('imports, exports, and reimports without losing package metadata', async () => {
    const imported = await service.importProfile({
      content: PROFILE_YAML,
      format: 'yaml',
      source: 'test-fixture',
    });
    expect(imported.created).toBe(true);
    expect(imported.profile.metadata).toMatchObject({ source: 'test-fixture' });

    const exported = await service.exportProfile('release-reviewer', 'json');
    const reimported = await service.importProfile({ content: exported.content, format: 'json' });

    expect(reimported.created).toBe(false);
    expect(reimported.profile).toMatchObject({
      id: 'release-reviewer',
      version: '1.0.0',
      displayName: 'Release Reviewer',
      runtime: { agent: 'codex', provider: 'codex-cli', model: 'gpt-5.1' },
      tools: { allowed: ['shell', 'git'] },
      permissions: { level: 'specialist' },
      policy: { sandboxPresetId: 'workspace-write-default' },
    });
  });

  it('updates enablement and resolves launch posture from existing provider settings', async () => {
    await service.importProfile({ content: PROFILE_YAML, format: 'yaml' });

    const updated = await service.updateProfile('release-reviewer', {
      enabled: false,
      displayName: 'Release QA Reviewer',
    });
    expect(updated.enabled).toBe(false);
    await expect(service.resolveLaunch('release-reviewer')).rejects.toThrow(/disabled/);

    await service.updateProfile('release-reviewer', { enabled: true });
    const launch = await service.resolveLaunch('release-reviewer');

    expect(launch).toMatchObject({
      agent: 'codex',
      model: 'gpt-5.1',
      sandboxPresetId: 'workspace-write-default',
      metadata: {
        id: 'release-reviewer',
        displayName: 'Release QA Reviewer',
        version: '1.0.0',
        agent: 'codex',
        provider: 'codex-cli',
        model: 'gpt-5.1',
      },
    });
    expect(launch.budget?.limits?.totalTokens).toBe(50000);
    expect(launch.instructions).toContain('Verify release notes');
  });
});
