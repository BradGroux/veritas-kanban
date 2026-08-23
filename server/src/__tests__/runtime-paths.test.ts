import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDocsDir, getProjectRoot, getRuntimeDir, getStorageRoot } from '../utils/paths.js';
import { migrateLegacyRuntimeState } from '../utils/migrate-legacy-runtime.js';

describe('runtime storage contract', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('gives DATA_DIR precedence and nests runtime state beneath the storage root', () => {
    vi.stubEnv('DATA_DIR', '/app/data');
    vi.stubEnv('VERITAS_DATA_DIR', '/ignored/legacy-override');

    expect(getStorageRoot()).toBe('/app/data');
    expect(getRuntimeDir()).toBe('/app/data/.veritas-kanban');
    expect(getDocsDir()).toBe('/app/data/docs');
  });

  it('uses VERITAS_DATA_DIR as the storage root when DATA_DIR is absent', () => {
    vi.stubEnv('DATA_DIR', '');
    vi.stubEnv('VERITAS_DATA_DIR', '/srv/veritas');

    expect(getStorageRoot()).toBe('/srv/veritas');
    expect(getRuntimeDir()).toBe('/srv/veritas/.veritas-kanban');
  });

  it('copies legacy runtime trees without deleting sources or overwriting current files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-runtime-migration-'));
    const legacy = path.join(root, 'legacy');
    const current = path.join(root, 'current');

    try {
      await fs.mkdir(path.join(legacy, 'nested'), { recursive: true });
      await fs.mkdir(current, { recursive: true });
      await fs.writeFile(path.join(legacy, 'config.json'), 'legacy config');
      await fs.writeFile(path.join(legacy, 'nested', 'state.json'), 'legacy nested state');
      await fs.writeFile(path.join(legacy, 'security.json'), 'legacy secret');
      await fs.writeFile(path.join(current, 'security.json'), 'current secret');

      await expect(migrateLegacyRuntimeState([legacy], current)).resolves.toBe(2);
      await expect(fs.readFile(path.join(current, 'config.json'), 'utf-8')).resolves.toBe(
        'legacy config'
      );
      await expect(fs.readFile(path.join(current, 'nested', 'state.json'), 'utf-8')).resolves.toBe(
        'legacy nested state'
      );
      await expect(fs.readFile(path.join(current, 'security.json'), 'utf-8')).resolves.toBe(
        'current secret'
      );
      await expect(fs.readFile(path.join(legacy, 'config.json'), 'utf-8')).resolves.toBe(
        'legacy config'
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not recurse into canonical runtime state or copy task and docs trees', async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-nested-migration-'));
    const current = path.join(storageRoot, '.veritas-kanban');

    try {
      await fs.mkdir(current, { recursive: true });
      await fs.mkdir(path.join(storageRoot, 'tasks', 'active'), { recursive: true });
      await fs.mkdir(path.join(storageRoot, 'docs'), { recursive: true });
      await fs.writeFile(path.join(storageRoot, 'legacy-state.json'), 'legacy state');
      await fs.writeFile(path.join(current, 'current-state.json'), 'current state');
      await fs.writeFile(path.join(storageRoot, 'tasks', 'active', 'task.md'), 'task');
      await fs.writeFile(path.join(storageRoot, 'docs', 'guide.md'), 'guide');

      await expect(migrateLegacyRuntimeState([storageRoot], current)).resolves.toBe(1);
      await expect(fs.readFile(path.join(current, 'legacy-state.json'), 'utf-8')).resolves.toBe(
        'legacy state'
      );
      await expect(fs.access(path.join(current, '.veritas-kanban'))).rejects.toThrow();
      await expect(fs.access(path.join(current, 'tasks'))).rejects.toThrow();
      await expect(fs.access(path.join(current, 'docs'))).rejects.toThrow();
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it('keeps Docker persistence on the single DATA_DIR volume', async () => {
    const projectRoot = getProjectRoot();
    const dockerfile = await fs.readFile(path.join(projectRoot, 'Dockerfile'), 'utf-8');
    const compose = await fs.readFile(path.join(projectRoot, 'docker-compose.yml'), 'utf-8');

    expect(dockerfile).toContain('ENV DATA_DIR=/app/data');
    expect(dockerfile).toContain('mkdir -p /app/data');
    expect(dockerfile).not.toMatch(/mkdir[^\n]*\/app\/\.veritas-kanban/);
    expect(dockerfile).not.toMatch(/mkdir[^\n]*\/app\/tasks/);
    expect(compose).toContain('kanban-demo-data:/app/data');
    expect(compose).not.toContain(':/app/.veritas-kanban');
  });
});
