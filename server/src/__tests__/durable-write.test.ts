import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeAll } from '../storage/fs-helpers.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('writeAll', () => {
  it('persists exact UTF-8 bytes across partial writes before the caller syncs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-durable-write-'));
    roots.push(root);
    const filePath = path.join(root, 'journal.jsonl');
    const handle = await fs.open(filePath, 'a');
    const content = '{"summary":"before 🛡️ after"}\n';
    const expected = Buffer.from(content, 'utf8');
    const writes: number[] = [];

    try {
      await writeAll(
        {
          write: async (buffer, offset, length, position) => {
            expect(position).toBeNull();
            const chunkLength = Math.min(1, length);
            const result = await handle.write(buffer, offset, chunkLength, position);
            writes.push(result.bytesWritten);
            return result;
          },
        },
        content
      );
      await handle.sync();
    } finally {
      await handle.close();
    }

    expect(writes).toHaveLength(expected.byteLength);
    expect(await fs.readFile(filePath)).toEqual(expected);
    expect(await fs.readFile(filePath, 'utf8')).toBe(content);
  });

  it('fails in one attempt when a write makes no progress', async () => {
    const write = vi.fn().mockResolvedValue({ bytesWritten: 0 });

    await expect(writeAll({ write }, 'durable')).rejects.toThrow(/no forward progress/i);
    expect(write).toHaveBeenCalledOnce();
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 100])(
    'rejects an invalid native byte count %s without acknowledging the write',
    async (bytesWritten) => {
      const write = vi.fn().mockResolvedValue({ bytesWritten });
      await expect(writeAll({ write }, 'durable')).rejects.toThrow(/valid byte count/i);
      expect(write).toHaveBeenCalledOnce();
    }
  );

  it('propagates a later write failure without reaching durability acknowledgement', async () => {
    const writeFailure = new Error('simulated storage failure');
    const write = vi
      .fn()
      .mockResolvedValueOnce({ bytesWritten: 2 })
      .mockRejectedValueOnce(writeFailure);
    const sync = vi.fn();

    await expect(writeAll({ write }, 'durable').then(sync)).rejects.toBe(writeFailure);
    expect(write).toHaveBeenCalledTimes(2);
    expect(sync).not.toHaveBeenCalled();
  });
});
