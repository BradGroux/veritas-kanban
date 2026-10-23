import fs, { cp, open, readFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopPaths, ensureDesktopPathLayout } from '../paths.js';
import { DesktopRuntime } from '../runtime.js';
import { ProcessSupervisor } from '../process-supervisor.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    cp: vi.fn(actual.cp),
    open: vi.fn(actual.open),
    readFile: vi.fn(actual.readFile),
    rename: vi.fn(actual.rename),
  };
});
const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(cp).mockImplementation(native.cp);
  vi.mocked(open).mockImplementation(native.open);
  vi.mocked(readFile).mockImplementation(native.readFile);
  vi.mocked(rename).mockImplementation(native.rename);
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(packaged = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-path-migration-'));
  roots.push(root);
  const paths = createDesktopPaths({
    userDataPath: path.join(root, 'userData'),
    repoRoot: root,
    isPackaged: packaged,
    profile: 'fixture',
  });
  const legacyData = path.join(paths.legacyAppHome!, 'data');
  await fs.mkdir(legacyData, { recursive: true });
  await fs.writeFile(path.join(legacyData, 'first.json'), 'legacy first');
  await fs.writeFile(path.join(legacyData, 'second.json'), 'legacy second');
  return { root, paths, legacyData };
}
function incomplete(paths: ReturnType<typeof createDesktopPaths>) {
  return {
    schemaVersion: 1,
    state: 'in-progress',
    migrated: false,
    from: paths.legacyAppHome,
    to: paths.appHome,
    copiedEntries: [],
  };
}

describe('desktop one-time legacy path migration', () => {
  it.each([false, true])(
    'retains source and target changes after completion, packaged=%s',
    async (packaged) => {
      const { paths, legacyData } = await fixture(packaged);
      for (const entry of ['config', 'logs', 'exports', 'backups', 'debug-bundles']) {
        await fs.mkdir(path.join(paths.legacyAppHome!, entry), { recursive: true });
        await fs.writeFile(
          path.join(paths.legacyAppHome!, entry, 'retired.json'),
          `legacy ${entry}`
        );
      }
      await fs.mkdir(paths.dataDir, { recursive: true });
      await fs.writeFile(path.join(paths.dataDir, 'first.json'), 'current workspace');
      const first = await ensureDesktopPathLayout(paths);
      expect(first.migrated).toBe(true);
      expect(first.copiedEntries).toEqual([
        'config',
        'data',
        'logs',
        'exports',
        'backups',
        'debug-bundles',
      ]);
      expect(await fs.readFile(path.join(paths.dataDir, 'first.json'), 'utf8')).toBe(
        'current workspace'
      );
      expect(await fs.readFile(path.join(legacyData, 'first.json'), 'utf8')).toBe('legacy first');
      const manifest = await fs.readFile(paths.migrationManifest, 'utf8');
      expect(JSON.parse(manifest).state).toBe('completed');
      for (const entry of first.copiedEntries) {
        const file = entry === 'data' ? 'second.json' : 'retired.json';
        await fs.rm(path.join(paths.appHome, entry, file));
        await fs.writeFile(
          path.join(paths.legacyAppHome!, entry, 'later.json'),
          'later legacy data'
        );
      }
      const copied = vi.mocked(cp).mock.calls.length;
      expect(await ensureDesktopPathLayout(paths)).toMatchObject({
        migrated: false,
        copiedEntries: [],
        skippedReason: 'legacy migration already completed',
      });
      expect(vi.mocked(cp).mock.calls).toHaveLength(copied);
      for (const entry of first.copiedEntries) {
        await expect(
          fs.stat(
            path.join(paths.appHome, entry, entry === 'data' ? 'second.json' : 'retired.json')
          )
        ).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.stat(path.join(paths.appHome, entry, 'later.json'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
      expect(await fs.readFile(paths.migrationManifest, 'utf8')).toBe(manifest);
    }
  );

  it('recognizes the previous unversioned completed result without rewriting or recopying', async () => {
    const { paths } = await fixture();
    const result = await ensureDesktopPathLayout(paths);
    const legacyManifest = JSON.stringify(result, null, 2);
    await fs.writeFile(paths.migrationManifest, legacyManifest);
    await fs.rm(path.join(paths.dataDir, 'first.json'));
    await ensureDesktopPathLayout(paths);
    await expect(fs.stat(path.join(paths.dataDir, 'first.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readFile(paths.migrationManifest, 'utf8')).toBe(legacyManifest);
  });

  it('records first initialization even when the legacy home is absent', async () => {
    const { paths, legacyData } = await fixture();
    await fs.rm(paths.legacyAppHome!, { recursive: true });
    expect(await ensureDesktopPathLayout(paths)).toMatchObject({
      migrated: false,
      skippedReason: 'legacy app home does not exist',
    });
    await fs.mkdir(legacyData, { recursive: true });
    await fs.writeFile(path.join(legacyData, 'later.json'), 'late source');
    await ensureDesktopPathLayout(paths);
    await expect(fs.stat(path.join(paths.dataDir, 'later.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('stops the actual runtime before either process starts when migration is incomplete', async () => {
    const { root, paths, legacyData } = await fixture();
    await fs.mkdir(paths.configDir, { recursive: true });
    await fs.mkdir(paths.dataDir, { recursive: true });
    await fs.writeFile(path.join(paths.dataDir, 'partial.json'), 'retained partial copy');
    const marker = JSON.stringify(incomplete(paths));
    await fs.writeFile(paths.migrationManifest, marker);
    const start = vi
      .spyOn(ProcessSupervisor.prototype, 'start')
      .mockRejectedValue(new Error('fixture must not start'));
    const runtime = new DesktopRuntime({
      repoRoot: root,
      paths,
      serverPort: 1,
      webPort: 2,
      isPackaged: false,
      profile: paths.profile,
      workspace: paths.workspace,
      secrets: { adminKey: 'fixture-only', jwtSecret: 'fixture-only', warnings: [] },
      secretsBackedByKeychain: false,
    });
    await expect(runtime.start()).rejects.toThrow(/Startup stopped.*back up.*Reconcile/);
    expect(start).not.toHaveBeenCalled();
    expect(await fs.readFile(paths.migrationManifest, 'utf8')).toBe(marker);
    expect(await fs.readFile(path.join(paths.dataDir, 'partial.json'), 'utf8')).toBe(
      'retained partial copy'
    );
    expect(await fs.readFile(path.join(legacyData, 'first.json'), 'utf8')).toBe('legacy first');
    await expect(fs.stat(path.join(paths.runtimeDir, 'server-state.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('retains an interrupted partial copy and refuses automatic restart or recopy', async () => {
    const { paths, legacyData } = await fixture();
    vi.mocked(cp).mockImplementation(async (source, destination) => {
      await native.copyFile(
        path.join(String(source), 'first.json'),
        path.join(String(destination), 'first.json')
      );
      throw new Error('fixture copy interrupted');
    });
    await expect(ensureDesktopPathLayout(paths)).rejects.toThrow(/both copies are preserved/);
    expect(JSON.parse(await fs.readFile(paths.migrationManifest, 'utf8')).state).toBe(
      'in-progress'
    );
    expect(await fs.readFile(path.join(paths.dataDir, 'first.json'), 'utf8')).toBe('legacy first');
    await expect(fs.stat(path.join(paths.dataDir, 'second.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readFile(path.join(legacyData, 'second.json'), 'utf8')).toBe('legacy second');
    await expect(ensureDesktopPathLayout(paths)).rejects.toThrow(/Reconcile the copies explicitly/);
    expect(cp).toHaveBeenCalledTimes(1);
    // Explicit operator recovery: retain the chosen workspace and finalize its marker.
    const manifest = JSON.parse(await fs.readFile(paths.migrationManifest, 'utf8'));
    await fs.writeFile(
      paths.migrationManifest,
      JSON.stringify({ ...manifest, state: 'completed', migrated: true, copiedEntries: ['data'] })
    );
    expect((await ensureDesktopPathLayout(paths)).migrated).toBe(false);
    expect(cp).toHaveBeenCalledTimes(1);
  });

  it('allows only one startup to copy while another sees the in-progress marker', async () => {
    const { paths } = await fixture();
    let entered!: () => void;
    let release!: () => void;
    const copying = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(cp).mockImplementation(async (...args) => {
      entered();
      await gate;
      await native.cp(...args);
    });
    const first = ensureDesktopPathLayout(paths);
    await copying;
    try {
      await expect(ensureDesktopPathLayout(paths)).rejects.toThrow(/Startup stopped/);
    } finally {
      release();
      await first;
    }
    expect(cp).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readFile(paths.migrationManifest, 'utf8')).state).toBe('completed');
  });

  it('requires the initial marker to sync before copying and preserves it on sync failure', async () => {
    const { paths, legacyData } = await fixture();
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await native.open(...args);
      if (String(args[0]) === paths.migrationManifest)
        vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('fixture sync failed'));
      return handle;
    });
    await expect(ensureDesktopPathLayout(paths)).rejects.toThrow(/Startup stopped/);
    expect(cp).not.toHaveBeenCalled();
    expect(JSON.parse(await fs.readFile(paths.migrationManifest, 'utf8')).state).toBe(
      'in-progress'
    );
    expect(await fs.readFile(path.join(legacyData, 'first.json'), 'utf8')).toBe('legacy first');
    await expect(fs.stat(path.join(paths.dataDir, 'first.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('retains an incomplete marker if completion replacement fails and removes its owned temporary file', async () => {
    const { paths } = await fixture();
    vi.mocked(rename).mockImplementation(async (source, destination) => {
      if (String(destination) === paths.migrationManifest)
        throw new Error('fixture replacement failed');
      await native.rename(source, destination);
    });
    await expect(ensureDesktopPathLayout(paths)).rejects.toThrow(/Startup stopped/);
    expect(JSON.parse(await fs.readFile(paths.migrationManifest, 'utf8')).state).toBe(
      'in-progress'
    );
    expect(await fs.readdir(paths.configDir)).toEqual(['desktop-path-migration.json']);
    await expect(ensureDesktopPathLayout(paths)).rejects.toThrow(/Reconcile the copies explicitly/);
    expect(cp).toHaveBeenCalledTimes(1);
  });

  it.each(['invalid-json', 'wrong-target', 'unknown-version', 'unknown-entry'])(
    'preserves an unverifiable %s marker and both data copies',
    async (kind) => {
      const { paths, legacyData } = await fixture();
      await fs.mkdir(paths.configDir, { recursive: true });
      const manifest = {
        ...incomplete(paths),
        state: 'completed',
        ...(kind === 'wrong-target' ? { to: 'other-workspace' } : {}),
        ...(kind === 'unknown-version' ? { schemaVersion: 99 } : {}),
        ...(kind === 'unknown-entry' ? { migrated: true, copiedEntries: ['unknown'] } : {}),
      };
      const content = kind === 'invalid-json' ? '{retained bytes' : JSON.stringify(manifest);
      await fs.writeFile(paths.migrationManifest, content);
      await expect(ensureDesktopPathLayout(paths)).rejects.toThrow(/manifest cannot be verified/);
      expect(await fs.readFile(paths.migrationManifest, 'utf8')).toBe(content);
      expect(await fs.readFile(path.join(legacyData, 'first.json'), 'utf8')).toBe('legacy first');
      expect(cp).not.toHaveBeenCalled();
    }
  );

  it('does not treat an unreadable manifest as a first migration', async () => {
    const { paths } = await fixture();
    await fs.mkdir(paths.configDir, { recursive: true });
    await fs.writeFile(paths.migrationManifest, 'retained marker');
    vi.mocked(readFile).mockImplementation((async (
      file: Parameters<typeof readFile>[0],
      options: Parameters<typeof readFile>[1]
    ) => {
      if (String(file) === paths.migrationManifest)
        throw Object.assign(new Error('fixture read denied'), { code: 'EACCES' });
      return native.readFile(file, options);
    }) as typeof readFile);
    await expect(ensureDesktopPathLayout(paths)).rejects.toThrow(/Startup stopped/);
    expect(await fs.readFile(paths.migrationManifest, 'utf8')).toBe('retained marker');
    expect(cp).not.toHaveBeenCalled();
  });
});
