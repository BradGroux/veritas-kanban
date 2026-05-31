import { describe, expect, it } from 'vitest';

import {
  buildServerEnvironment,
  buildWebEnvironment,
  createDesktopAdminKey,
  createManagedProcessConfigs,
} from '../lifecycle.js';
import type { DesktopLifecycleOptions } from '../lifecycle.js';

function options(): DesktopLifecycleOptions {
  return {
    repoRoot: '/repo/veritas-kanban',
    paths: {
      appHome: '/tmp/veritas-desktop',
      configDir: '/tmp/veritas-desktop/config',
      dataDir: '/tmp/veritas-desktop/data',
      logsDir: '/tmp/veritas-desktop/logs',
      runtimeDir: '/tmp/veritas-desktop/runtime',
      exportsDir: '/tmp/veritas-desktop/exports',
      backupsDir: '/tmp/veritas-desktop/backups',
      debugBundlesDir: '/tmp/veritas-desktop/debug-bundles',
    },
    serverPort: 39123,
    webPort: 39124,
    isPackaged: false,
  };
}

describe('desktop lifecycle config', () => {
  it('creates a dev-only admin key shape without fixed secrets', () => {
    expect(createDesktopAdminKey('fresh profile')).toMatch(/^desktop-dev-admin-key-fresh-profile-/);
  });

  it('builds loopback server environment for local desktop dev mode', () => {
    const env = buildServerEnvironment(options(), 'desktop-dev-admin-key-test-000000000000');

    expect(env.HOST).toBe('127.0.0.1');
    expect(env.PORT).toBe('39123');
    expect(env.VERITAS_STORAGE).toBe('sqlite');
    expect(env.VERITAS_DATA_DIR).toBe('/tmp/veritas-desktop/data');
    expect(env.VERITAS_AUTH_ENABLED).toBe('false');
    expect(env.CORS_ORIGINS).toContain('http://127.0.0.1:39124');
  });

  it('points web dev proxies at the selected server port', () => {
    const env = buildWebEnvironment(options());

    expect(env.VITE_API_PROXY_TARGET).toBe('http://127.0.0.1:39123');
    expect(env.VITE_WS_PROXY_TARGET).toBe('ws://127.0.0.1:39123');
  });

  it('creates server and web process configs in dev mode', () => {
    const configs = createManagedProcessConfigs(
      options(),
      'desktop-dev-admin-key-test-000000000000'
    );

    expect(configs.map((config) => config.name)).toEqual(['server', 'web']);
    expect(configs[0]?.readyUrl).toBe('http://127.0.0.1:39123/api/health');
    expect(configs[1]?.readyUrl).toBe('http://127.0.0.1:39124');
  });
});
