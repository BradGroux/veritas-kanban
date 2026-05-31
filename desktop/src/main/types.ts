export type DesktopProcessName = 'server' | 'web';

export type DesktopProcessState = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export type DesktopConnectionMode = 'local-dev' | 'local-production';

export interface DesktopPaths {
  appHome: string;
  configDir: string;
  dataDir: string;
  logsDir: string;
  runtimeDir: string;
  exportsDir: string;
  backupsDir: string;
  debugBundlesDir: string;
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
  server: ManagedProcessSnapshot;
  web?: ManagedProcessSnapshot;
  serverOrigin: string | null;
  rendererOrigin: string | null;
  appHome: string;
  lastError: string | null;
}

export interface DesktopAppInfo {
  name: string;
  appId: string;
  version: string;
  platform: NodeJS.Platform;
  packaged: boolean;
}
