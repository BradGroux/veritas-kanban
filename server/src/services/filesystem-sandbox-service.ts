import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type {
  ExecutableAgentProvider,
  FilesystemSandboxBackendStatus,
  RunLaunchFilesystemRootEvidence,
  RunLaunchFilesystemSandboxEvidence,
  SandboxPolicyDryRunResult,
  SandboxPolicyPreset,
  SandboxProviderCapabilityId,
} from '@veritas-kanban/shared';
import { FILESYSTEM_SANDBOX_EVIDENCE_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import {
  activateRunSandboxDirectories,
  assertNoExternalHardLinksRuntime,
  assertProtectedMetadataPathsRuntime,
  canonicalizeExistingPaths,
  createFilesystemSandboxProbeFixture,
  digestSandboxPath,
  FilesystemSandboxRuntimeError,
  inspectGitMetadataRoots,
  removeFilesystemSandboxProbeFixture,
  removeRunSandboxDirectory,
  resolveGitIdentity,
  resolveFilesystemSandboxExecutable,
  resolveSandboxPolicyPath,
  runtimePackageRoot,
  runSandboxDirectories,
  systemMountPoints,
  type RunSandboxDirectories,
} from '../utils/filesystem-sandbox-runtime.js';

const FILESYSTEM_SANDBOX_PROBE_REVISION = 2;
const FILESYSTEM_CAPABILITIES: SandboxProviderCapabilityId[] = [
  'filesystem.read',
  'filesystem.write',
  'filesystem.deny-paths',
  'filesystem.dotfile-masking',
  'filesystem.protected-metadata',
  'filesystem.descendants',
  'filesystem.run-scoped-temp',
  'filesystem.cleanup',
];
const WRAPPABLE_LOCAL_PROVIDERS = new Set<ExecutableAgentProvider>([
  'acp-stdio',
  'claude-code',
  'codex-app-server',
  'codex-cli',
  'hermes-cli',
]);
const PROTECTED_METADATA_NAMES = ['.agents', '.codex', '.git', '.veritas-kanban'];
const HARD_LINK_SCAN_MAX_ENTRIES = 250_000;
const execFileAsync = promisify(execFile);

interface SandboxPathEntry {
  path: string;
  access: 'read' | 'write' | 'deny';
  scope: RunLaunchFilesystemRootEvidence['scope'];
  id: string;
}

interface CodexSandboxState {
  permissionProfile: {
    type: 'managed';
    file_system: {
      type: 'restricted';
      entries: Array<
        | {
            path: { type: 'path'; path: string };
            access: 'read' | 'write' | 'deny';
          }
        | {
            path: { type: 'glob_pattern'; pattern: string };
            access: 'deny';
          }
        | {
            path: { type: 'special'; value: { kind: 'minimal' | 'root' } };
            access: 'read';
          }
      >;
    };
    network: 'restricted' | 'enabled';
  };
  codexLinuxSandboxExe: null;
  sandboxCwd: string;
  useLegacyLandlock: false;
}

export interface FilesystemSandboxCommandResult {
  stdout: string;
  stderr: string;
}

export type FilesystemSandboxCommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number }
) => Promise<FilesystemSandboxCommandResult>;

export interface FilesystemSandboxServiceOptions {
  command?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  runCommand?: FilesystemSandboxCommandRunner;
  mountPoints?: () => Promise<string[]>;
  gitIdentity?: (cwd: string) => Promise<{ name?: string; email?: string }>;
}

export interface FilesystemSandboxCompileInput {
  taskId: string;
  attemptId: string;
  provider: ExecutableAgentProvider;
  workspacePath: string;
  sandboxPolicy: SandboxPolicyDryRunResult;
  providerRuntimeManifestDigest: string;
  providerCommand?: string;
}

export interface FilesystemSandboxLaunchPlan {
  evidence: RunLaunchFilesystemSandboxEvidence;
  directories?: RunSandboxDirectories;
  wrapper?: {
    command: string;
    sandboxStateJson: string;
    executableFingerprint: string;
  };
  environment: Record<string, string>;
  mountGuard?: {
    configuredEntries: SandboxPathEntry[];
    topologyHash: string;
  };
}

export interface FilesystemSandboxWrappedLaunch {
  command: string;
  args: string[];
  cwd: string;
  environment: Record<string, string>;
}

interface CachedProbe {
  status: FilesystemSandboxBackendStatus;
}

const probeCache = new Map<string, CachedProbe>();

export class FilesystemSandboxService {
  private readonly command: string;
  private readonly platform: NodeJS.Platform;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly runCommand: FilesystemSandboxCommandRunner;
  private readonly mountPoints: () => Promise<string[]>;
  private readonly gitIdentity: (cwd: string) => Promise<{ name?: string; email?: string }>;

  constructor(options: FilesystemSandboxServiceOptions = {}) {
    this.command =
      options.command ?? process.env.VERITAS_FILESYSTEM_SANDBOX_COMMAND?.trim() ?? 'codex';
    this.platform = options.platform ?? process.platform;
    this.environment = options.environment ?? process.env;
    this.runCommand = options.runCommand ?? defaultRunCommand;
    this.mountPoints = options.mountPoints ?? (() => systemMountPoints(this.platform));
    this.gitIdentity = options.gitIdentity ?? resolveGitIdentity;
  }

  async probe(provider?: string): Promise<FilesystemSandboxBackendStatus> {
    if (!WRAPPABLE_LOCAL_PROVIDERS.has(provider as ExecutableAgentProvider)) {
      if (provider === 'codex-sdk') {
        return unavailableStatus(
          'The Codex SDK owns its provider process, so exact filesystem roots require provider-native evidence.',
          ['filesystem.run-scoped-temp', 'filesystem.cleanup']
        );
      }
      return unavailableStatus(
        provider === 'openclaw'
          ? 'Remote providers cannot use the host-local filesystem sandbox wrapper.'
          : 'The selected adapter does not expose a wrappable local provider process.'
      );
    }
    const platformBackend = platformBackendFor(this.platform);
    if (platformBackend === 'none') {
      return unavailableStatus(
        `No supported filesystem sandbox backend exists for ${this.platform}.`
      );
    }
    try {
      const executable = await resolveFilesystemSandboxExecutable(this.command, this.environment);
      const versionResult = await this.runCommand(executable.path, ['--version'], {
        timeoutMs: 3_000,
      });
      const version = parseCodexVersion(versionResult.stdout || versionResult.stderr);
      const cacheKey = [
        executable.fingerprint,
        version,
        this.platform,
        FILESYSTEM_SANDBOX_PROBE_REVISION,
      ].join(':');
      const cached = probeCache.get(cacheKey);
      if (cached) return cached.status;
      const help = await this.runCommand(executable.path, ['sandbox', '--help'], {
        timeoutMs: 3_000,
      });
      const helpText = `${help.stdout}\n${help.stderr}`;
      for (const requiredFlag of ['--sandbox-state-json', '--sandbox-state-disable-network']) {
        if (!helpText.includes(requiredFlag)) {
          return unavailableStatus(
            `Codex ${version} does not expose required filesystem sandbox flag ${requiredFlag}.`
          );
        }
      }
      await this.assertConformance(executable.path);
      const status: FilesystemSandboxBackendStatus = {
        backend: 'codex-sandbox',
        state: 'available',
        capabilityVersion: codexSandboxCapabilityVersion(version),
        backendVersion: version,
        backendExecutableDigest: executable.fingerprint,
        platformBackend,
        supported: [...FILESYSTEM_CAPABILITIES],
        reason: `Codex ${version} passed filesystem sandbox probe revision ${FILESYSTEM_SANDBOX_PROBE_REVISION}.`,
      };
      probeCache.set(cacheKey, { status });
      return status;
    } catch (error) {
      return unavailableStatus(
        error instanceof Error
          ? `Filesystem sandbox probe failed: ${error.message}`
          : 'Filesystem sandbox probe failed.'
      );
    }
  }

  async compile(input: FilesystemSandboxCompileInput): Promise<FilesystemSandboxLaunchPlan> {
    const preset = input.sandboxPolicy.preset;
    const status = input.sandboxPolicy.effective.filesystemBackend;
    const policyRequired = hasFilesystemRules(preset);
    if (preset.id === 'legacy-permissive' && preset.enforcement === 'advisory') {
      const roots = await compileRootEvidence(preset, input.workspacePath);
      return {
        evidence: {
          schemaVersion: FILESYSTEM_SANDBOX_EVIDENCE_SCHEMA_VERSION,
          providerRuntimeManifestDigest: input.providerRuntimeManifestDigest,
          backend: 'none',
          state: 'advisory',
          platformBackend: 'none',
          capabilityVersion: status.capabilityVersion,
          policyHash: policyHash(preset, roots),
          roots,
          protectedPaths: [],
          dotfileMasking: false,
          descendantsEnforced: false,
          cleanupOwner: 'none',
        },
        environment: {},
      };
    }
    if (status.backend === 'codex-sandbox' && status.state === 'available') {
      const current = await this.probe(input.provider);
      if (
        current.backend !== status.backend ||
        current.backendVersion !== status.backendVersion ||
        current.capabilityVersion !== status.capabilityVersion ||
        current.backendExecutableDigest !== status.backendExecutableDigest
      ) {
        throw new ConflictError('Filesystem sandbox backend changed after policy evaluation.', {
          expectedBackend: status.backend,
          expectedVersion: status.backendVersion,
          currentBackend: current.backend,
          currentVersion: current.backendVersion,
          expectedExecutableDigest: status.backendExecutableDigest,
          currentExecutableDigest: current.backendExecutableDigest,
          remediation: 'Re-evaluate the run policy against the current sandbox backend.',
        });
      }
      return this.compileCodexPlan(input, preset, current);
    }
    if (status.backend === 'provider-native' && status.state === 'native') {
      const configuredEntries = await compilePathEntries(preset, input.workspacePath);
      for (const capability of ['filesystem.run-scoped-temp', 'filesystem.cleanup'] as const) {
        if (!status.supported.includes(capability)) {
          throw new ConflictError(
            'Provider-native filesystem evidence is missing lifecycle enforcement.',
            {
              capability,
              remediation:
                'Re-probe the provider with run-scoped temp/cache and cleanup conformance evidence.',
            }
          );
        }
      }
      const mountGuard =
        input.provider === 'openclaw'
          ? undefined
          : await compileMountGuard(configuredEntries, await this.mountPoints());
      if (mountGuard && mountGuard.deniedEntries.length > 0) {
        throw new ConflictError(
          'Provider-native filesystem evidence cannot resolve nested mount boundaries.',
          {
            presetId: preset.id,
            mountBoundaryCount: mountGuard.deniedEntries.length,
            remediation:
              'Explicitly grant or deny each nested mount, or use the conformant host wrapper.',
          }
        );
      }
      if (mountGuard) {
        await assertProtectedMetadataPaths(configuredEntries);
        await assertNoExternalHardLinks(
          [...configuredEntries, ...mountGuard.deniedEntries],
          preset.filesystem.dotfileMasking
        );
      }
      const directories =
        input.provider === 'openclaw'
          ? undefined
          : runSandboxDirectories(input.taskId, input.attemptId);
      const roots = [
        ...evidenceFromEntries(configuredEntries),
        ...protectedEvidence(configuredEntries),
        ...(directories
          ? evidenceFromEntries([
              {
                id: 'run-temp',
                path: directories.tempPath,
                access: 'write',
                scope: 'run-temp',
              },
              {
                id: 'run-cache',
                path: directories.cachePath,
                access: 'write',
                scope: 'run-cache',
              },
              {
                id: 'run-artifact',
                path: directories.artifactPath,
                access: 'write',
                scope: 'run-artifact',
              },
            ])
          : []),
      ];
      return {
        evidence: {
          schemaVersion: FILESYSTEM_SANDBOX_EVIDENCE_SCHEMA_VERSION,
          providerRuntimeManifestDigest: input.providerRuntimeManifestDigest,
          backend: 'provider-native',
          state: 'native',
          platformBackend: 'provider-native',
          capabilityVersion: status.capabilityVersion,
          ...(status.backendVersion ? { backendVersion: status.backendVersion } : {}),
          policyHash: policyHash(preset, roots),
          roots,
          protectedPaths: [...PROTECTED_METADATA_NAMES],
          dotfileMasking: preset.filesystem.dotfileMasking,
          descendantsEnforced: true,
          cleanupOwner: directories ? 'run-supervisor' : 'provider-native',
        },
        ...(directories ? { directories } : {}),
        environment: directories ? runDirectoryEnvironment(directories) : {},
        ...(mountGuard
          ? {
              mountGuard: {
                configuredEntries,
                topologyHash: mountGuard.topologyHash,
              },
            }
          : {}),
      };
    }
    if (preset.enforcement === 'required' && policyRequired) {
      throw new ConflictError('Required filesystem sandbox rules cannot be enforced.', {
        presetId: preset.id,
        backend: status.backend,
        reason: status.reason,
        remediation:
          'Install a conformant local sandbox backend or select a provider with supported native filesystem enforcement.',
      });
    }
    const roots = await compileRootEvidence(preset, input.workspacePath);
    return {
      evidence: {
        schemaVersion: FILESYSTEM_SANDBOX_EVIDENCE_SCHEMA_VERSION,
        providerRuntimeManifestDigest: input.providerRuntimeManifestDigest,
        backend: 'none',
        state: policyRequired ? 'advisory' : 'unavailable',
        platformBackend: 'none',
        capabilityVersion: status.capabilityVersion,
        policyHash: policyHash(preset, roots),
        roots,
        protectedPaths: [],
        dotfileMasking: false,
        descendantsEnforced: false,
        cleanupOwner: 'none',
      },
      environment: {},
    };
  }

  async activate(plan: FilesystemSandboxLaunchPlan): Promise<void> {
    if (plan.wrapper) {
      const currentExecutable = await resolveFilesystemSandboxExecutable(
        plan.wrapper.command,
        this.environment
      );
      if (
        currentExecutable.path !== plan.wrapper.command ||
        currentExecutable.fingerprint !== plan.wrapper.executableFingerprint
      ) {
        throw new ConflictError(
          'Filesystem sandbox executable changed after launch manifest compilation.',
          {
            expectedExecutableDigest: plan.wrapper.executableFingerprint,
            currentExecutableDigest: currentExecutable.fingerprint,
            remediation: 'Re-probe the backend and compile a new launch manifest.',
          }
        );
      }
    }
    if (plan.mountGuard) {
      const current = await compileMountGuard(
        plan.mountGuard.configuredEntries,
        await this.mountPoints()
      );
      if (current.topologyHash !== plan.mountGuard.topologyHash) {
        throw new ConflictError(
          'Filesystem mount topology changed after launch manifest compilation.',
          {
            expectedTopologyHash: plan.mountGuard.topologyHash,
            currentTopologyHash: current.topologyHash,
            remediation: 'Re-evaluate the sandbox policy against the current mount topology.',
          }
        );
      }
      await assertProtectedMetadataPaths([
        ...plan.mountGuard.configuredEntries,
        ...current.deniedEntries,
      ]);
      await assertNoExternalHardLinks(
        [...plan.mountGuard.configuredEntries, ...current.deniedEntries],
        plan.evidence.dotfileMasking
      );
    }
    if (plan.directories) await activateRunSandboxDirectories(plan.directories);
  }

  async cleanup(plan: FilesystemSandboxLaunchPlan): Promise<void> {
    if (plan.directories) await removeRunSandboxDirectory(plan.directories.rootPath);
  }

  wrap(
    plan: FilesystemSandboxLaunchPlan,
    command: string,
    args: string[],
    cwd: string
  ): FilesystemSandboxWrappedLaunch {
    if (!plan.wrapper) {
      return { command, args: [...args], cwd, environment: { ...plan.environment } };
    }
    return {
      command: plan.wrapper.command,
      args: ['sandbox', '--sandbox-state-json', plan.wrapper.sandboxStateJson, command, ...args],
      cwd,
      environment: { ...plan.environment },
    };
  }

  private async compileCodexPlan(
    input: FilesystemSandboxCompileInput,
    preset: SandboxPolicyPreset,
    status: FilesystemSandboxBackendStatus
  ): Promise<FilesystemSandboxLaunchPlan> {
    const directories = runSandboxDirectories(input.taskId, input.attemptId);
    const executable = await resolveFilesystemSandboxExecutable(this.command, this.environment);
    if (
      !status.backendExecutableDigest ||
      executable.fingerprint !== status.backendExecutableDigest
    ) {
      throw new ConflictError('Filesystem sandbox executable changed after backend conformance.', {
        expectedExecutableDigest: status.backendExecutableDigest,
        currentExecutableDigest: executable.fingerprint,
        remediation: 'Re-probe the backend and re-evaluate the sandbox policy.',
      });
    }
    const configuredEntries = await compilePathEntries(preset, input.workspacePath);
    const mountGuard = await compileMountGuard(configuredEntries, await this.mountPoints());
    await assertProtectedMetadataPaths(configuredEntries);
    await assertNoExternalHardLinks(
      [...configuredEntries, ...mountGuard.deniedEntries],
      preset.filesystem.dotfileMasking
    );
    const gitMetadataEntries = await compileGitMetadataReadEntries(input.workspacePath);
    const runtimeEntries = await compileRuntimeReadEntries(
      input.providerCommand ?? defaultProviderCommand(input.provider),
      input.workspacePath,
      this.environment,
      this.platform,
      [await runtimePackageRoot(executable.path)]
    );
    const baseEntries: SandboxPathEntry[] = [
      ...runtimeEntries,
      ...configuredEntries,
      ...gitMetadataEntries,
      ...mountGuard.deniedEntries,
      {
        id: 'run-temp',
        path: directories.tempPath,
        access: 'write',
        scope: 'run-temp',
      },
      {
        id: 'run-cache',
        path: directories.cachePath,
        access: 'write',
        scope: 'run-cache',
      },
      {
        id: 'run-artifact',
        path: directories.artifactPath,
        access: 'write',
        scope: 'run-artifact',
      },
    ];
    const entries = [...baseEntries, ...compileProtectedMetadataReadEntries(baseEntries)];
    const rootEvidence = evidenceFromEntries(entries);
    rootEvidence.unshift({
      id: 'platform-runtime',
      access: 'read',
      scope: 'platform-runtime',
      pathDigest: digestRunLaunchValue({
        backend: status.platformBackend,
        capabilityVersion: status.capabilityVersion,
      }),
    });
    const state = buildCodexSandboxState({
      cwd: input.workspacePath,
      entries,
      dotfileMasking: preset.filesystem.dotfileMasking,
      networkEnabled: input.sandboxPolicy.effective.networkAccessEnabled,
      legacyRootRead: false,
    });
    const protectedPaths = protectedEvidence(entries);
    const gitIdentity = await this.gitIdentity(input.workspacePath);
    return {
      evidence: {
        schemaVersion: FILESYSTEM_SANDBOX_EVIDENCE_SCHEMA_VERSION,
        providerRuntimeManifestDigest: input.providerRuntimeManifestDigest,
        backend: 'codex-sandbox',
        state: 'enforced',
        platformBackend: status.platformBackend,
        capabilityVersion: status.capabilityVersion,
        ...(status.backendVersion ? { backendVersion: status.backendVersion } : {}),
        backendExecutableDigest: executable.fingerprint,
        policyHash: policyHash(preset, rootEvidence),
        roots: [...rootEvidence, ...protectedPaths],
        protectedPaths: [...PROTECTED_METADATA_NAMES],
        dotfileMasking: preset.filesystem.dotfileMasking,
        descendantsEnforced: true,
        cleanupOwner: 'run-supervisor',
      },
      directories,
      wrapper: {
        command: executable.path,
        sandboxStateJson: JSON.stringify(state),
        executableFingerprint: executable.fingerprint,
      },
      environment: {
        ...runDirectoryEnvironment(directories),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: nullDevicePath(this.platform),
        ...(gitIdentity.name
          ? {
              GIT_AUTHOR_NAME: gitIdentity.name,
              GIT_COMMITTER_NAME: gitIdentity.name,
            }
          : {}),
        ...(gitIdentity.email
          ? {
              GIT_AUTHOR_EMAIL: gitIdentity.email,
              GIT_COMMITTER_EMAIL: gitIdentity.email,
            }
          : {}),
      },
      mountGuard: {
        configuredEntries,
        topologyHash: mountGuard.topologyHash,
      },
    };
  }

  private async assertConformance(command: string): Promise<void> {
    const fixture = await createFilesystemSandboxProbeFixture();
    try {
      const baseEntries: SandboxPathEntry[] = [
        ...(await compileRuntimeReadEntries(
          undefined,
          fixture.workspacePath,
          this.environment,
          this.platform,
          [await runtimePackageRoot(command)]
        )),
        {
          id: 'probe-workspace',
          path: fixture.workspacePath,
          access: 'write',
          scope: 'workspace',
        },
        {
          id: 'probe-denied',
          path: fixture.outsidePath,
          access: 'deny',
          scope: 'absolute',
        },
      ];
      const entries = [...baseEntries, ...compileProtectedMetadataReadEntries(baseEntries)];
      const maskedState = buildCodexSandboxState({
        cwd: fixture.workspacePath,
        entries,
        dotfileMasking: true,
        networkEnabled: false,
        legacyRootRead: false,
      });
      const probeScript = [
        "const fs=require('node:fs');",
        "const cp=require('node:child_process');",
        'const p=JSON.parse(process.argv[1]);',
        "if(fs.readFileSync(p.allowed,'utf8')!=='allowed')throw new Error('allowed read failed');",
        "fs.writeFileSync(p.write,'ok');",
        "const denied=(fn,label)=>{let allowed=false;try{fn();allowed=true}catch{}if(allowed)throw new Error(label+' was allowed');};",
        "denied(()=>fs.readFileSync(p.denied),'denied read');",
        "denied(()=>fs.writeFileSync(p.outsideWrite,'x'),'outside write');",
        "denied(()=>fs.writeFileSync(p.symlink,'x'),'symlink escape');",
        "denied(()=>fs.readFileSync(p.dotfile),'dotfile read');",
        "denied(()=>fs.linkSync(p.denied,p.hardlink),'hard-link escape');",
        "const child=cp.spawnSync(process.execPath,['-e',`require('node:fs').writeFileSync(${JSON.stringify(p.childWrite)},'x')`]);",
        "if(child.status===0)throw new Error('descendant escape was allowed');",
        "const toolEnv={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};",
        "const git=cp.spawnSync('git',['--version'],{encoding:'utf8',env:toolEnv});",
        "if(git.status!==0||!git.stdout.startsWith('git version'))throw new Error(`PATH tool execution failed: ${git.error?.message||git.stderr||`status ${git.status}`}`);",
        "const backend=cp.spawnSync(p.backend,['--version'],{encoding:'utf8'});",
        'if(backend.status!==0||!/codex/i.test(backend.stdout+backend.stderr))throw new Error(`backend re-exec failed: ${backend.error?.message||backend.stderr||`status ${backend.status}`}`);',
      ].join('');
      await this.runCommand(
        command,
        [
          'sandbox',
          '--sandbox-state-json',
          JSON.stringify(maskedState),
          process.execPath,
          '-e',
          probeScript,
          JSON.stringify({
            allowed: fixture.allowedFile,
            write: path.join(fixture.workspacePath, 'write.txt'),
            denied: fixture.deniedFile,
            outsideWrite: path.join(fixture.outsidePath, 'write.txt'),
            symlink: fixture.symlinkPath,
            dotfile: fixture.dotfile,
            hardlink: path.join(fixture.workspacePath, 'hardlink'),
            childWrite: path.join(fixture.outsidePath, 'child.txt'),
            backend: command,
          }),
        ],
        { cwd: fixture.workspacePath, timeoutMs: 8_000 }
      );

      const metadataState = buildCodexSandboxState({
        cwd: fixture.workspacePath,
        entries: entries.filter((entry) => entry.access !== 'deny'),
        dotfileMasking: false,
        networkEnabled: false,
        legacyRootRead: false,
      });
      const metadataScript = [
        "const fs=require('node:fs');",
        'const paths=JSON.parse(process.argv[1]);',
        "for(const p of paths){if(!fs.readFileSync(p,'utf8'))throw new Error('metadata read failed');",
        "let allowed=false;try{fs.writeFileSync(p,'changed');allowed=true}catch{}",
        "if(allowed)throw new Error('protected metadata write was allowed');}",
      ].join('');
      await this.runCommand(
        command,
        [
          'sandbox',
          '--sandbox-state-json',
          JSON.stringify(metadataState),
          process.execPath,
          '-e',
          metadataScript,
          JSON.stringify([fixture.protectedFile, fixture.veritasProtectedFile]),
        ],
        { cwd: fixture.workspacePath, timeoutMs: 8_000 }
      );
    } finally {
      await removeFilesystemSandboxProbeFixture(fixture.rootPath);
    }
  }
}

function buildCodexSandboxState(input: {
  cwd: string;
  entries: SandboxPathEntry[];
  dotfileMasking: boolean;
  networkEnabled: boolean;
  legacyRootRead: boolean;
}): CodexSandboxState {
  const configuredEntries: CodexSandboxState['permissionProfile']['file_system']['entries'] = [
    {
      path: {
        type: 'special',
        value: { kind: input.legacyRootRead ? 'root' : 'minimal' },
      },
      access: 'read',
    },
    ...input.entries.map((entry) => ({
      path: { type: 'path' as const, path: entry.path },
      access: entry.access,
    })),
  ];
  if (input.dotfileMasking) {
    for (const entry of input.entries) {
      if (
        entry.access === 'deny' ||
        entry.scope === 'platform-runtime' ||
        entry.scope === 'protected-metadata'
      ) {
        continue;
      }
      configuredEntries.push({
        path: {
          type: 'glob_pattern',
          pattern: `${entry.path.replaceAll('\\', '/')}/**/.*`,
        },
        access: 'deny',
      });
    }
  }
  return {
    permissionProfile: {
      type: 'managed',
      file_system: {
        type: 'restricted',
        entries: configuredEntries,
      },
      network: input.networkEnabled ? 'enabled' : 'restricted',
    },
    codexLinuxSandboxExe: null,
    sandboxCwd: pathToFileURL(path.resolve(input.cwd)).href,
    useLegacyLandlock: false,
  };
}

async function compilePathEntries(
  preset: SandboxPolicyPreset,
  workspacePath: string
): Promise<SandboxPathEntry[]> {
  const groups: Array<{
    values: string[];
    access: SandboxPathEntry['access'];
    prefix: string;
  }> = [
    { values: preset.filesystem.readPaths, access: 'read', prefix: 'read' },
    { values: preset.filesystem.writePaths, access: 'write', prefix: 'write' },
    { values: preset.filesystem.deniedPaths, access: 'deny', prefix: 'deny' },
  ];
  const entries: SandboxPathEntry[] = [];
  for (const group of groups) {
    for (const [index, value] of group.values.entries()) {
      const resolved = await resolveSandboxPolicyPath(value, workspacePath);
      entries.push({
        id: `${group.prefix}-${index + 1}`,
        path: resolved.path,
        access: group.access,
        scope: resolved.scope,
      });
    }
  }
  const unique = uniqueEntries(entries);
  const workspace = await resolveSandboxPolicyPath('<workspace>', workspacePath);
  assertNoProtectedMetadataWriteEntries(unique, workspace.path);
  return unique;
}

async function compileRootEvidence(
  preset: SandboxPolicyPreset,
  workspacePath: string
): Promise<RunLaunchFilesystemRootEvidence[]> {
  return evidenceFromEntries(await compilePathEntries(preset, workspacePath));
}

function compileProtectedMetadataReadEntries(entries: SandboxPathEntry[]): SandboxPathEntry[] {
  return uniqueEntries(
    entries
      .filter((entry) => entry.access === 'write')
      .flatMap((entry) =>
        PROTECTED_METADATA_NAMES.map((name) => ({
          id: `protected-read-${entry.id}-${name.slice(1)}`,
          path: path.join(entry.path, name),
          access: 'read' as const,
          scope: 'protected-metadata' as const,
        }))
      )
  );
}

async function compileGitMetadataReadEntries(workspacePath: string): Promise<SandboxPathEntry[]> {
  return (await inspectGitMetadataRoots(workspacePath)).map((metadataPath, index) => ({
    id: `git-metadata-${index + 1}`,
    path: metadataPath,
    access: 'read',
    scope: 'protected-metadata',
  }));
}

async function compileMountGuard(
  configuredEntries: SandboxPathEntry[],
  mountPoints: string[]
): Promise<{ deniedEntries: SandboxPathEntry[]; topologyHash: string }> {
  const allowedEntries = configuredEntries.filter(
    (entry) => entry.access === 'read' || entry.access === 'write'
  );
  const deniedEntries = configuredEntries.filter((entry) => entry.access === 'deny');
  const relevantMounts: string[] = [];
  const protectedMounts: string[] = [];

  for (const canonicalMount of await canonicalizeExistingPaths(mountPoints)) {
    if (!allowedEntries.some((entry) => pathIsWithin(entry.path, canonicalMount))) continue;
    relevantMounts.push(canonicalMount);
    const explicitlyGranted = allowedEntries.some((entry) => entry.path === canonicalMount);
    const alreadyDenied = deniedEntries.some((entry) => pathIsWithin(entry.path, canonicalMount));
    if (!explicitlyGranted && !alreadyDenied) protectedMounts.push(canonicalMount);
  }

  return {
    deniedEntries: protectedMounts.map((mountPoint, index) => ({
      id: `mount-deny-${index + 1}`,
      path: mountPoint,
      access: 'deny',
      scope: 'absolute',
    })),
    topologyHash: digestRunLaunchValue({
      mounts: relevantMounts.sort().map((mountPoint) => digestSandboxPath(mountPoint)),
    }),
  };
}

async function assertNoExternalHardLinks(
  entries: SandboxPathEntry[],
  dotfileMasking: boolean
): Promise<void> {
  try {
    await assertNoExternalHardLinksRuntime({
      entries,
      dotfileMasking,
      protectedMetadataNames: PROTECTED_METADATA_NAMES,
      maxEntries: HARD_LINK_SCAN_MAX_ENTRIES,
    });
  } catch (error) {
    if (error instanceof FilesystemSandboxRuntimeError) {
      throw new ConflictError(error.message, error.details);
    }
    throw error;
  }
}

async function assertProtectedMetadataPaths(entries: SandboxPathEntry[]): Promise<void> {
  try {
    await assertProtectedMetadataPathsRuntime({
      entries,
      protectedMetadataNames: PROTECTED_METADATA_NAMES,
    });
  } catch (error) {
    if (error instanceof FilesystemSandboxRuntimeError) {
      throw new ConflictError(error.message, error.details);
    }
    throw error;
  }
}

function isProtectedMetadataChild(candidate: string, writeRoots: string[]): boolean {
  return writeRoots.some((root) => {
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
    const firstComponent = relative.split(path.sep)[0];
    return PROTECTED_METADATA_NAMES.includes(firstComponent);
  });
}

function assertNoProtectedMetadataWriteEntries(
  entries: SandboxPathEntry[],
  workspacePath: string
): void {
  const writeEntries = entries.filter((entry) => entry.access === 'write');
  for (const entry of writeEntries) {
    const parentRoots = [
      workspacePath,
      ...writeEntries.filter((candidate) => candidate !== entry).map((candidate) => candidate.path),
    ];
    const resolvedEntryPath = path.resolve(entry.path);
    const pathComponents = resolvedEntryPath
      .slice(path.parse(resolvedEntryPath).root.length)
      .split(path.sep)
      .filter(Boolean);
    if (
      pathComponents.some((component) => PROTECTED_METADATA_NAMES.includes(component)) ||
      isProtectedMetadataChild(entry.path, parentRoots)
    ) {
      throw new ConflictError('Protected repository metadata cannot be a writable policy root.', {
        remediation:
          'Remove explicit writes to .git, .agents, .codex, or .veritas-kanban and keep the containing workspace writable instead.',
      });
    }
  }
}

async function compileRuntimeReadEntries(
  providerCommand: string | undefined,
  workspacePath: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  additionalRoots: string[] = []
): Promise<SandboxPathEntry[]> {
  const roots = new Set<string>([
    ...platformRuntimeRoots(platform, environment, workspacePath),
    ...additionalRoots,
  ]);
  if (providerCommand?.trim()) {
    try {
      const executable = await resolveFilesystemSandboxExecutable(
        providerCommand.trim(),
        environment
      );
      roots.add(await runtimePackageRoot(executable.path));
    } catch (error) {
      throw new Error(`Provider executable cannot be bound to the filesystem sandbox.`, {
        cause: error,
      });
    }
  }
  const entries: SandboxPathEntry[] = [];
  for (const [index, root] of [...roots].sort().entries()) {
    const resolved = await resolveSandboxPolicyPath(root, workspacePath);
    entries.push({
      id: `runtime-${index + 1}`,
      path: resolved.path,
      access: 'read',
      scope: 'platform-runtime',
    });
  }
  return entries;
}

function platformRuntimeRoots(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  basePath: string
): string[] {
  const roots = [path.dirname(path.dirname(process.execPath))];
  for (const entry of (environment.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const resolved = path.resolve(basePath, entry);
    if (resolved !== path.parse(resolved).root) roots.push(resolved);
  }
  if (platform === 'darwin') {
    roots.push(
      '/opt/homebrew/opt',
      '/opt/homebrew/Cellar',
      '/opt/homebrew/etc/openssl@3/openssl.cnf',
      '/usr/local/opt',
      '/usr/local/Cellar',
      '/usr/local/etc/openssl@3/openssl.cnf'
    );
  } else if (platform === 'linux') {
    roots.push('/home/linuxbrew/.linuxbrew/opt', '/home/linuxbrew/.linuxbrew/Cellar', '/nix/store');
  }
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function evidenceFromEntries(entries: SandboxPathEntry[]): RunLaunchFilesystemRootEvidence[] {
  return entries
    .map((entry) => ({
      id: entry.id,
      access: entry.access,
      scope: entry.scope,
      pathDigest: digestSandboxPath(entry.path),
    }))
    .sort(
      (left, right) =>
        left.access.localeCompare(right.access) ||
        left.scope.localeCompare(right.scope) ||
        left.pathDigest.localeCompare(right.pathDigest)
    );
}

function protectedEvidence(entries: SandboxPathEntry[]): RunLaunchFilesystemRootEvidence[] {
  return entries
    .filter((entry) => entry.access === 'write')
    .flatMap((entry) =>
      PROTECTED_METADATA_NAMES.map((name) => ({
        id: `protected-${entry.id}-${name.slice(1)}`,
        access: 'protected' as const,
        scope: entry.scope,
        pathDigest: digestSandboxPath(path.join(entry.path, name)),
      }))
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueEntries(entries: SandboxPathEntry[]): SandboxPathEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.access}\0${entry.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pathIsWithin(basePath: string, targetPath: string): boolean {
  const relative = path.relative(basePath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function defaultProviderCommand(provider: ExecutableAgentProvider): string | undefined {
  if (provider === 'codex-cli' || provider === 'codex-app-server') return 'codex';
  if (provider === 'claude-code') return 'claude';
  if (provider === 'hermes-cli') return 'hermes';
  return undefined;
}

function policyHash(preset: SandboxPolicyPreset, roots: RunLaunchFilesystemRootEvidence[]): string {
  return digestRunLaunchValue({
    presetId: preset.id,
    enforcement: preset.enforcement,
    roots,
    dotfileMasking: preset.filesystem.dotfileMasking,
    localOnlyHandles: preset.filesystem.localOnlyHandles,
  });
}

function hasFilesystemRules(preset: SandboxPolicyPreset): boolean {
  return (
    preset.filesystem.readPaths.length > 0 ||
    preset.filesystem.writePaths.length > 0 ||
    preset.filesystem.deniedPaths.length > 0 ||
    preset.filesystem.dotfileMasking ||
    preset.filesystem.localOnlyHandles
  );
}

function platformBackendFor(
  platform: NodeJS.Platform
): FilesystemSandboxBackendStatus['platformBackend'] {
  if (platform === 'darwin') return 'seatbelt';
  if (platform === 'linux') return 'landlock-bubblewrap';
  if (platform === 'win32') return 'restricted-token';
  return 'none';
}

function unavailableStatus(
  reason: string,
  supported: SandboxProviderCapabilityId[] = []
): FilesystemSandboxBackendStatus {
  return {
    backend: 'none',
    state: 'unavailable',
    capabilityVersion: `filesystem-sandbox-probe/v${FILESYSTEM_SANDBOX_PROBE_REVISION}`,
    platformBackend: 'none',
    supported,
    reason,
  };
}

function parseCodexVersion(value: string): string {
  const match = value.match(/\bcodex(?:-cli)?\s+v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i);
  if (!match) throw new Error('Codex CLI version output is not recognized.');
  return match[1];
}

function codexSandboxCapabilityVersion(version: string): string {
  return `codex-sandbox-state/v${version}+vk.${FILESYSTEM_SANDBOX_PROBE_REVISION}`;
}

function nullDevicePath(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'NUL' : '/dev/null';
}

function runDirectoryEnvironment(directories: RunSandboxDirectories): Record<string, string> {
  return {
    TMPDIR: directories.tempPath,
    TMP: directories.tempPath,
    TEMP: directories.tempPath,
    XDG_CACHE_HOME: directories.cachePath,
    VERITAS_ARTIFACT_ROOT: directories.artifactPath,
  };
}

async function defaultRunCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number }
): Promise<FilesystemSandboxCommandResult> {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    maxBuffer: 1024 * 1024,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

let singleton: FilesystemSandboxService | undefined;

export function getFilesystemSandboxService(): FilesystemSandboxService {
  singleton ??= new FilesystemSandboxService();
  return singleton;
}

export function resetFilesystemSandboxServiceForTests(): void {
  singleton = undefined;
  probeCache.clear();
}
