import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('security config legacy runtime compatibility', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('copies legacy security state into the canonical runtime directory', async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-security-migration-'));
    const legacyConfig = {
      authEnabled: true,
      sessionTimeout: '12h',
      setupCompletedAt: '2026-08-23T00:00:00.000Z',
    };

    try {
      vi.stubEnv('DATA_DIR', storageRoot);
      vi.stubEnv('VERITAS_DATA_DIR', '');
      await fs.writeFile(path.join(storageRoot, 'security.json'), JSON.stringify(legacyConfig));

      const security = await import('../config/security.js');

      expect(security.getSecurityConfig()).toMatchObject(legacyConfig);
      await expect(
        fs.readFile(path.join(storageRoot, '.veritas-kanban', 'security.json'), 'utf-8')
      ).resolves.toBe(JSON.stringify(legacyConfig));
      await expect(fs.readFile(path.join(storageRoot, 'security.json'), 'utf-8')).resolves.toBe(
        JSON.stringify(legacyConfig)
      );
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });
});
