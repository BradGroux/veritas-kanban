import { describe, expect, it } from 'vitest';

import {
  buildServerEnvironment,
  buildWebEnvironment,
  createManagedProcessConfigs,
} from '../lifecycle.js';
import type { DesktopLifecycleOptions } from '../lifecycle.js';

function options(): DesktopLifecycleOptions {
  return {
    repoRoot: '/repo/veritas-kanban',
    paths: {
      profile: 'fresh-profile',
      workspace: 'local',
      appHome: '/tmp/veritas-desktop',
      profileDir: '/tmp/veritas-desktop-profile',
      workspaceDir: '/tmp/veritas-desktop',
      legacyAppHome: null,
      configDir: '/tmp/veritas-desktop/config',
      dataDir: '/tmp/veritas-desktop/data',
      logsDir: '/tmp/veritas-desktop/logs',
      runtimeDir: '/tmp/veritas-desktop/runtime',
      exportsDir: '/tmp/veritas-desktop/exports',
      backupsDir: '/tmp/veritas-desktop/backups',
      debugBundlesDir: '/tmp/veritas-desktop/debug-bundles',
      secretsFile: '/tmp/veritas-desktop/config/desktop-secrets.json',
      migrationManifest: '/tmp/veritas-desktop/config/desktop-path-migration.json',
    },
    serverPort: 39123,
    webPort: 39124,
    isPackaged: false,
    secrets: {
      adminKey: 'desktop-keychain-admin-key',
      jwtSecret: 'desktop-keychain-jwt-secret',
      warnings: [],
    },
  };
}

describe('desktop lifecycle config', () => {
  it('builds loopback server environment for local desktop dev mode', () => {
    const env = buildServerEnvironment(options());

    expect(env.HOST).toBe('127.0.0.1');
    expect(env.PORT).toBe('39123');
    expect(env.VERITAS_ADMIN_KEY).toBe('desktop-keychain-admin-key');
    expect(env.VERITAS_JWT_SECRET).toBe('desktop-keychain-jwt-secret');
    expect(env.VERITAS_STORAGE).toBe('sqlite');
    expect(env.VERITAS_DESKTOP_RUNTIME).toBe('0');
    expect(env.DATA_DIR).toBe('/tmp/veritas-desktop/data');
    expect(env.VERITAS_DATA_DIR).toBe('/tmp/veritas-desktop/data');
    expect(env.VERITAS_AUTH_ENABLED).toBe('false');
    expect(env.CORS_ORIGINS).toContain('http://127.0.0.1:39124');
  });

  it('runs packaged server with the Electron binary in Node mode from resources', () => {
    const configs = createManagedProcessConfigs({
      ...options(),
      isPackaged: true,
      resourcesPath: '/Applications/Veritas Kanban.app/Contents/Resources',
    });

    expect(configs).toHaveLength(1);
    expect(configs[0]?.args).toEqual([
      '/Applications/Veritas Kanban.app/Contents/Resources/server/dist/index.js',
    ]);
    expect(configs[0]?.cwd).toBe('/Applications/Veritas Kanban.app/Contents/Resources/server');
    expect(configs[0]?.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(configs[0]?.env.VERITAS_DESKTOP_RUNTIME).toBe('1');
    expect(configs[0]?.env.VERITAS_AUTH_ENABLED).toBe('true');
  });

  it('points web dev proxies at the selected server port', () => {
    const env = buildWebEnvironment(options());

    expect(env.VITE_API_PROXY_TARGET).toBe('http://127.0.0.1:39123');
    expect(env.VITE_WS_PROXY_TARGET).toBe('ws://127.0.0.1:39123');
  });

  it('creates server and web process configs in dev mode', () => {
    const configs = createManagedProcessConfigs(options());

    expect(configs.map((config) => config.name)).toEqual(['server', 'web']);
    expect(configs[0]?.readyUrl).toBe('http://127.0.0.1:39123/api/health');
    expect(configs[1]?.readyUrl).toBe('http://127.0.0.1:39124');
  });
});
