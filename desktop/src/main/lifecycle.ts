import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { DesktopPaths, ManagedProcessConfig } from './types.js';

const ADMIN_KEY_PREFIX = 'desktop-dev-admin-key';

export interface DesktopLifecycleOptions {
  repoRoot: string;
  paths: DesktopPaths;
  serverPort: number;
  webPort: number;
  isPackaged: boolean;
}

function pnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

export function createDesktopAdminKey(profile = 'default'): string {
  const safeProfile = profile.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${ADMIN_KEY_PREFIX}-${safeProfile}-${randomUUID()}`;
}

export function buildServerEnvironment(
  options: DesktopLifecycleOptions,
  adminKey: string
): NodeJS.ProcessEnv {
  const serverOrigin = `http://127.0.0.1:${options.serverPort}`;
  const webOrigin = `http://127.0.0.1:${options.webPort}`;

  return {
    ...process.env,
    NODE_ENV: options.isPackaged ? 'production' : 'development',
    HOST: '127.0.0.1',
    PORT: String(options.serverPort),
    VERITAS_ADMIN_KEY: adminKey,
    VERITAS_AUTH_ENABLED: options.isPackaged ? 'true' : 'false',
    VERITAS_AUTH_LOCALHOST_BYPASS: 'false',
    VERITAS_STORAGE: 'sqlite',
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
  options: DesktopLifecycleOptions,
  adminKey: string
): ManagedProcessConfig[] {
  const serverConfig: ManagedProcessConfig = options.isPackaged
    ? {
        name: 'server',
        command: process.execPath,
        args: [
          process.env.VERITAS_DESKTOP_SERVER_ENTRY ||
            path.join(options.repoRoot, 'server/dist/index.js'),
        ],
        cwd: options.repoRoot,
        env: buildServerEnvironment(options, adminKey),
        logFile: path.join(options.paths.logsDir, 'server.log'),
        readyUrl: `http://127.0.0.1:${options.serverPort}/api/health`,
      }
    : {
        name: 'server',
        command: pnpmCommand(),
        args: ['--filter', '@veritas-kanban/server', 'dev'],
        cwd: options.repoRoot,
        env: buildServerEnvironment(options, adminKey),
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
