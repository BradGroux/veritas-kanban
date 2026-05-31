import { EventEmitter } from 'node:events';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { createManagedProcessConfigs } from './lifecycle.js';
import { ensureDesktopPathLayout, type DesktopPathMigrationResult } from './paths.js';
import { ProcessSupervisor } from './process-supervisor.js';
import type { DesktopPaths, DesktopRuntimeSecrets, DesktopStatusSnapshot } from './types.js';

export interface DesktopRuntimeOptions {
  repoRoot: string;
  resourcesPath?: string;
  paths: DesktopPaths;
  serverPort: number;
  webPort: number;
  isPackaged: boolean;
  profile: string;
  workspace: string;
  secrets: DesktopRuntimeSecrets;
  secretsBackedByKeychain: boolean;
}

export class DesktopRuntime extends EventEmitter {
  private readonly server: ProcessSupervisor;
  private readonly web: ProcessSupervisor | null;
  private lastError: string | null = null;
  private readonly serverOrigin: string;
  private readonly rendererOrigin: string;
  private pathMigration: DesktopPathMigrationResult | null = null;
  private readonly warnings: string[] = [];

  constructor(private readonly options: DesktopRuntimeOptions) {
    super();
    this.warnings.push(...options.secrets.warnings);
    const [serverConfig, webConfig] = createManagedProcessConfigs(options);
    this.server = new ProcessSupervisor(serverConfig);
    this.web = webConfig ? new ProcessSupervisor(webConfig) : null;
    this.serverOrigin = `http://127.0.0.1:${options.serverPort}`;
    this.rendererOrigin = options.isPackaged
      ? this.serverOrigin
      : `http://127.0.0.1:${options.webPort}`;

    for (const supervisor of [this.server, this.web].filter(Boolean) as ProcessSupervisor[]) {
      supervisor.on('state', () => this.emitStatus());
      supervisor.on('error', (error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.emitStatus();
      });
    }
  }

  getRendererOrigin(): string {
    return this.rendererOrigin;
  }

  snapshot(): DesktopStatusSnapshot {
    return {
      mode: this.options.isPackaged ? 'local-production' : 'local-dev',
      profile: this.options.profile,
      workspace: this.options.workspace,
      server: this.server.snapshot(),
      web: this.web?.snapshot(),
      serverOrigin: this.serverOrigin,
      rendererOrigin: this.rendererOrigin,
      appHome: this.options.paths.appHome,
      dataDir: this.options.paths.dataDir,
      configDir: this.options.paths.configDir,
      logsDir: this.options.paths.logsDir,
      secretsBackedByKeychain: this.options.secretsBackedByKeychain,
      warnings: this.runtimeWarnings(),
      lastError: this.lastError,
    };
  }

  async start(): Promise<void> {
    await this.ensureDirectories();
    await this.writeRuntimeState();
    await this.server.start();
    await this.waitForReady(this.serverOrigin + '/api/health', 'server', this.server);
    this.server.markReady();

    if (this.web) {
      await this.web.start();
      await this.waitForReady(this.rendererOrigin, 'web', this.web);
      this.web.markReady();
    }

    this.emitStatus();
  }

  async restartLocalServer(): Promise<DesktopStatusSnapshot> {
    await this.server.restart();
    await this.waitForReady(this.serverOrigin + '/api/health', 'server', this.server);
    this.server.markReady();
    this.emitStatus();
    return this.snapshot();
  }

  async stop(): Promise<void> {
    await Promise.all([this.web?.stop(), this.server.stop()].filter(Boolean) as Promise<void>[]);
    await rm(path.join(this.options.paths.runtimeDir, 'server-state.json'), { force: true });
  }

  private async ensureDirectories(): Promise<void> {
    this.pathMigration = await ensureDesktopPathLayout(this.options.paths);
  }

  private async writeRuntimeState(): Promise<void> {
    await mkdir(this.options.paths.runtimeDir, { recursive: true });
    await writeFile(
      path.join(this.options.paths.runtimeDir, 'server-state.json'),
      JSON.stringify(
        {
          mode: this.options.isPackaged ? 'local-production' : 'local-dev',
          profile: this.options.profile,
          workspace: this.options.workspace,
          serverOrigin: this.serverOrigin,
          rendererOrigin: this.rendererOrigin,
          appHome: this.options.paths.appHome,
          dataDir: this.options.paths.dataDir,
          configDir: this.options.paths.configDir,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  }

  private async waitForReady(
    url: string,
    label: string,
    supervisor: ProcessSupervisor
  ): Promise<void> {
    const deadline = Date.now() + 45_000;
    let lastError: string | null = null;

    while (Date.now() < deadline) {
      const processSnapshot = supervisor.snapshot();
      if (processSnapshot.state === 'failed' || processSnapshot.state === 'stopped') {
        const detail = processSnapshot.lastError ? `: ${processSnapshot.lastError}` : '';
        this.lastError = `${label} stopped before becoming ready${detail}`;
        this.emitStatus();
        throw new Error(this.lastError);
      }

      try {
        const response = await fetch(url);
        if (response.ok) {
          return;
        }
        lastError = `${label} returned ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this.lastError = `${label} did not become ready: ${lastError ?? 'timeout'}`;
    this.emitStatus();
    throw new Error(this.lastError);
  }

  private emitStatus(): void {
    this.emit('status', this.snapshot());
  }

  private runtimeWarnings(): string[] {
    const warnings = [...this.warnings];
    if (this.pathMigration?.migrated && this.pathMigration.from) {
      warnings.push(
        `Desktop data was copied from ${this.pathMigration.from} to ${this.pathMigration.to}.`
      );
    }
    return warnings;
  }
}
