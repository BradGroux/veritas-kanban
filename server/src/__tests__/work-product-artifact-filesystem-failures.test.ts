import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  lstat: vi.fn(),
  open: vi.fn(),
  realpath: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    lstat: fsMocks.lstat,
    open: fsMocks.open,
    realpath: fsMocks.realpath,
  };
});

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const { FileWorkProductArtifactRepository, SecureWorkProductArtifactSourceReader } =
  await import('../storage/work-product-artifact-repository.js');

const cleanupPaths: string[] = [];

beforeEach(() => {
  fsMocks.lstat.mockImplementation((...args) => Reflect.apply(actualFs.lstat, actualFs, args));
  fsMocks.open.mockImplementation((...args) => Reflect.apply(actualFs.open, actualFs, args));
  fsMocks.realpath.mockImplementation((...args) =>
    Reflect.apply(actualFs.realpath, actualFs, args)
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanupPaths.splice(0).map((entry) => actualFs.rm(entry, { recursive: true })));
});

async function sourceFixture(content: string) {
  const root = await actualFs.mkdtemp(
    path.join(process.cwd(), '.veritas-artifact-source-failure-')
  );
  cleanupPaths.push(root);
  const sourcePath = path.join(root, 'artifact.txt');
  await actualFs.writeFile(sourcePath, content);
  const sourceStat = await actualFs.lstat(sourcePath);
  return { root, sourcePath, sourceStat };
}

function openedStat(
  sourceStat: Awaited<ReturnType<typeof actualFs.lstat>>,
  overrides: Record<string, unknown> = {}
) {
  return {
    isFile: () => true,
    nlink: sourceStat.nlink,
    ino: sourceStat.ino,
    dev: sourceStat.dev,
    size: sourceStat.size,
    mtimeMs: sourceStat.mtimeMs,
    ctimeMs: sourceStat.ctimeMs,
    ...overrides,
  };
}

describe('artifact filesystem race handling', () => {
  it('rejects an opened source that is no longer a regular file or has changed identity', async () => {
    const { root, sourceStat } = await sourceFixture('a');
    const close = vi.fn().mockResolvedValue(undefined);
    fsMocks.open.mockResolvedValueOnce({
      stat: vi.fn().mockResolvedValue(openedStat(sourceStat, { isFile: () => false })),
      close,
    });
    await expect(
      new SecureWorkProductArtifactSourceReader().read(root, 'artifact.txt', 10)
    ).rejects.toThrow(/regular file/);
    expect(close).toHaveBeenCalledOnce();

    fsMocks.open.mockResolvedValueOnce({
      stat: vi.fn().mockResolvedValue(openedStat(sourceStat, { ino: sourceStat.ino + 1 })),
      close,
    });
    await expect(
      new SecureWorkProductArtifactSourceReader().read(root, 'artifact.txt', 10)
    ).rejects.toThrow(/identity changed/);
  });

  it('rejects a source read that stalls, grows, or mutates', async () => {
    const { root, sourceStat } = await sourceFixture('a');
    const before = openedStat(sourceStat);
    fsMocks.open.mockResolvedValueOnce({
      stat: vi.fn().mockResolvedValue(before),
      read: vi.fn().mockResolvedValue({ bytesRead: 0 }),
      close: vi.fn().mockResolvedValue(undefined),
    });
    await expect(
      new SecureWorkProductArtifactSourceReader().read(root, 'artifact.txt', 10)
    ).rejects.toThrow(/changed while/);

    const empty = await sourceFixture('');
    fsMocks.open.mockResolvedValueOnce({
      stat: vi.fn().mockResolvedValue(openedStat(empty.sourceStat)),
      read: vi.fn().mockResolvedValue({ bytesRead: 1 }),
      close: vi.fn().mockResolvedValue(undefined),
    });
    await expect(
      new SecureWorkProductArtifactSourceReader().read(empty.root, 'artifact.txt', 10)
    ).rejects.toThrow(/size limit/);

    const read = vi
      .fn()
      .mockResolvedValueOnce({ bytesRead: 1 })
      .mockResolvedValueOnce({ bytesRead: 0 });
    const stat = vi
      .fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({ ...before, mtimeMs: before.mtimeMs + 1 });
    fsMocks.open.mockResolvedValueOnce({
      stat,
      read,
      close: vi.fn().mockResolvedValue(undefined),
    });
    await expect(
      new SecureWorkProductArtifactSourceReader().read(root, 'artifact.txt', 10)
    ).rejects.toThrow(/changed while/);
  });

  it('rejects artifact writes without progress and unexpected payload stat failures', async () => {
    const root = await actualFs.mkdtemp(
      path.join(process.cwd(), '.veritas-artifact-write-failure-')
    );
    cleanupPaths.push(root);
    const repository = new FileWorkProductArtifactRepository(path.join(root, 'artifacts'));
    fsMocks.open.mockResolvedValueOnce({
      write: vi.fn().mockResolvedValue({ bytesWritten: 0 }),
      sync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
    await expect(
      (
        repository as unknown as {
          writeExclusive(filePath: string, content: Uint8Array): Promise<void>;
        }
      ).writeExclusive(path.join(root, 'stalled.bin'), Buffer.from('a'))
    ).rejects.toThrow(/no forward progress/);

    const productDir = path.join(root, 'artifacts', 'local', 'wp_123456789012345678901234');
    await actualFs.mkdir(path.join(productDir, '1', 'wpa_123456789012345678901234'), {
      recursive: true,
      mode: 0o700,
    });
    fsMocks.lstat.mockImplementation((target, ...args) => {
      if (String(target).endsWith('payload.bin')) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      return Reflect.apply(actualFs.lstat, actualFs, [target, ...args]);
    });
    await expect(repository.deleteProduct('local', 'wp_123456789012345678901234')).rejects.toThrow(
      /denied/
    );
  });
});
