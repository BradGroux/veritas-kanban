export type DesktopProcessName = 'server' | 'web';

export type DesktopProcessState = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export type DesktopConnectionMode = 'local-dev' | 'local-production';

export interface DesktopPaths {
  profile: string;
  workspace: string;
  appHome: string;
  profileDir: string;
  workspaceDir: string;
  legacyAppHome: string | null;
  configDir: string;
  dataDir: string;
  logsDir: string;
  runtimeDir: string;
  exportsDir: string;
  backupsDir: string;
  debugBundlesDir: string;
  secretsFile: string;
  migrationManifest: string;
}

export interface DesktopRuntimeSecrets {
  adminKey: string;
  jwtSecret: string;
  warnings: string[];
}

export interface ManagedProcessConfig {
  name: DesktopProcessName;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logFile: string;
  readyUrl?: string;
  shutdownTimeoutMs?: number;
}

export interface ManagedProcessSnapshot {
  name: DesktopProcessName;
  state: DesktopProcessState;
  pid: number | null;
  port: number | null;
  lastError: string | null;
  startedAt: string | null;
  exitedAt: string | null;
}

export interface DesktopStatusSnapshot {
  mode: DesktopConnectionMode;
  profile: string;
  workspace: string;
  server: ManagedProcessSnapshot;
  web?: ManagedProcessSnapshot;
  serverOrigin: string | null;
  rendererOrigin: string | null;
  appHome: string;
  dataDir: string;
  configDir: string;
  logsDir: string;
  secretsBackedByKeychain: boolean;
  warnings: string[];
  lastError: string | null;
}

export interface DesktopAppInfo {
  name: string;
  appId: string;
  version: string;
  buildIdentity: string | null;
  channel: 'dev' | 'beta' | 'stable';
  platform: NodeJS.Platform;
  arch: string;
  osVersion: string;
  packaged: boolean;
}
