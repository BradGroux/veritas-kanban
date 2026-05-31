import path from 'node:path';

import type { DesktopPaths, DesktopRuntimeSecrets, ManagedProcessConfig } from './types.js';

export interface DesktopLifecycleOptions {
  repoRoot: string;
  resourcesPath?: string;
  paths: DesktopPaths;
  serverPort: number;
  webPort: number;
  isPackaged: boolean;
  secrets: DesktopRuntimeSecrets;
}

function pnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

export function buildServerEnvironment(options: DesktopLifecycleOptions): NodeJS.ProcessEnv {
  const serverOrigin = `http://127.0.0.1:${options.serverPort}`;
  const webOrigin = `http://127.0.0.1:${options.webPort}`;

  return {
    ...process.env,
    NODE_ENV: options.isPackaged ? 'production' : 'development',
    ...(options.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    HOST: '127.0.0.1',
    PORT: String(options.serverPort),
    VERITAS_ADMIN_KEY: options.secrets.adminKey,
    VERITAS_JWT_SECRET: options.secrets.jwtSecret,
    VERITAS_AUTH_ENABLED: options.isPackaged ? 'true' : 'false',
    VERITAS_AUTH_LOCALHOST_BYPASS: 'false',
    VERITAS_DESKTOP_RUNTIME: options.isPackaged ? '1' : '0',
    VERITAS_STORAGE: 'sqlite',
    DATA_DIR: options.paths.dataDir,
    VERITAS_DATA_DIR: options.paths.dataDir,
    VERITAS_DISABLE_WATCHERS: '1',
    CORS_ORIGINS: `${serverOrigin},${webOrigin},http://localhost:${options.webPort}`,
  };
}

export function buildWebEnvironment(options: DesktopLifecycleOptions): NodeJS.ProcessEnv {
  const serverOrigin = `http://127.0.0.1:${options.serverPort}`;

  return {
    ...process.env,
    VITE_HOST: '127.0.0.1',
    VITE_API_PROXY_TARGET: serverOrigin,
    VITE_WS_PROXY_TARGET: serverOrigin.replace(/^http/, 'ws'),
  };
}

export function createManagedProcessConfigs(
  options: DesktopLifecycleOptions
): ManagedProcessConfig[] {
  const packagedServerRoot = options.resourcesPath
    ? path.join(options.resourcesPath, 'server')
    : path.join(options.repoRoot, 'server');
  const packagedServerEntry =
    process.env.VERITAS_DESKTOP_SERVER_ENTRY || path.join(packagedServerRoot, 'dist', 'index.js');

  const serverConfig: ManagedProcessConfig = options.isPackaged
    ? {
        name: 'server',
        command: process.execPath,
        args: [packagedServerEntry],
        cwd: packagedServerRoot,
        env: buildServerEnvironment(options),
        logFile: path.join(options.paths.logsDir, 'server.log'),
        readyUrl: `http://127.0.0.1:${options.serverPort}/api/health`,
      }
    : {
        name: 'server',
        command: pnpmCommand(),
        args: ['--filter', '@veritas-kanban/server', 'dev'],
        cwd: options.repoRoot,
        env: buildServerEnvironment(options),
        logFile: path.join(options.paths.logsDir, 'server.log'),
        readyUrl: `http://127.0.0.1:${options.serverPort}/api/health`,
      };

  if (options.isPackaged) {
    return [serverConfig];
  }

  const webConfig: ManagedProcessConfig = {
    name: 'web',
    command: pnpmCommand(),
    args: [
      '--filter',
      '@veritas-kanban/web',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      String(options.webPort),
    ],
    cwd: options.repoRoot,
    env: buildWebEnvironment(options),
    logFile: path.join(options.paths.logsDir, 'web.log'),
    readyUrl: `http://127.0.0.1:${options.webPort}`,
  };

  return [serverConfig, webConfig];
}
