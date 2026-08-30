import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());
const assertApiPermissionForRequest = vi.hoisted(() => vi.fn());
vi.mock('../utils/api.js', () => ({
  API_BASE: 'http://localhost:3001',
  api,
  assertApiPermissionForRequest,
  buildApiHeaders: vi.fn(() => ({ 'content-type': 'application/json' })),
}));

import { registerWorkProductCommands } from '../commands/work-products.js';

const cleanupPaths: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(cleanupPaths.splice(0).map((entry) => fs.rm(entry, { recursive: true })));
});

function program(): Command {
  const command = new Command().exitOverride();
  registerWorkProductCommands(command);
  return command;
}

describe('vk work-products commands', () => {
  it('registers with the stable runtime identity and prints JSON', async () => {
    api.mockResolvedValue({ product: { id: 'wp_1' }, metadata: { id: 'wpa_1' } });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program().parseAsync([
      'node',
      'vk',
      'work-products',
      'register',
      '--task',
      'task_1',
      '--run',
      'run_1',
      '--attempt',
      'attempt_1',
      '--request-id',
      'request_1',
      '--event',
      'event_1',
      '--path',
      'report.pdf',
      '--title',
      'Release report',
      '--media-type',
      'application/pdf',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith('/api/work-products/artifacts/register', {
      method: 'POST',
      body: JSON.stringify({
        taskId: 'task_1',
        runId: 'run_1',
        attemptId: 'attempt_1',
        requestId: 'request_1',
        producingEventId: 'event_1',
        relativePath: 'report.pdf',
        title: 'Release report',
        mediaType: 'application/pdf',
      }),
    });
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
      product: { id: 'wp_1' },
      metadata: { id: 'wpa_1' },
    });
    output.mockRestore();
  });

  it('lists archived file products with machine-readable output', async () => {
    api.mockResolvedValue([{ id: 'wp_1', kind: 'file' }]);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program().parseAsync([
      'node',
      'vk',
      'work-products',
      'list',
      '--task',
      'task_1',
      '--include-archived',
      '--limit',
      '25',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith(
      '/api/work-products/artifacts?limit=25&taskId=task_1&includeArchived=true'
    );
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual([{ id: 'wp_1', kind: 'file' }]);
    output.mockRestore();
  });

  it('downloads bytes without overwriting an existing destination by default', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), '.vk-work-product-download-'));
    cleanupPaths.push(root);
    const outputPath = path.join(root, 'artifact.bin');
    const sha256 = createHash('sha256').update('artifact bytes').digest('hex');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(Buffer.from('artifact bytes'), {
            status: 200,
            headers: {
              'content-digest': 'sha-256=:q8Ej:',
              'x-artifact-sha256': sha256,
            },
          })
      )
    );
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program().parseAsync([
      'node',
      'vk',
      'work-products',
      'download',
      'wp_1',
      '--version',
      '2',
      '--output',
      outputPath,
      '--json',
    ]);

    expect(await fs.readFile(outputPath, 'utf8')).toBe('artifact bytes');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/work-products/wp_1/artifact/download?version=2',
      expect.any(Object)
    );
    expect(assertApiPermissionForRequest).toHaveBeenCalledWith(
      '/api/work-products/wp_1/artifact/download?version=2'
    );
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      productId: 'wp_1',
      version: 2,
      output: outputPath,
      byteSize: 14,
      sha256,
      contentDigest: 'sha-256=:q8Ej:',
    });
    output.mockRestore();
  });

  it('rejects downloaded bytes that do not match the server integrity digest', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), '.vk-work-product-download-'));
    cleanupPaths.push(root);
    const outputPath = path.join(root, 'artifact.bin');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(Buffer.from('tampered bytes'), {
            status: 200,
            headers: { 'x-artifact-sha256': '0'.repeat(64) },
          })
      )
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await program().parseAsync([
      'node',
      'vk',
      'work-products',
      'download',
      'wp_1',
      '--output',
      outputPath,
    ]);

    await expect(fs.access(outputPath)).rejects.toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Downloaded artifact bytes did not match the server integrity digest')
    );
    expect(process.exitCode).toBe(1);
    error.mockRestore();
  });

  it('requires exact explicit confirmation for physical purge requests', async () => {
    const productId = `wp_${'a'.repeat(24)}`;
    api.mockResolvedValue({ productId, artifactsDeleted: 2, bytesDeleted: 42 });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program().parseAsync([
      'node',
      'vk',
      'work-products',
      'purge',
      productId,
      '--confirm',
      productId,
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith(
      `/api/work-products/${productId}/artifact?confirm=${productId}`,
      { method: 'DELETE' }
    );
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
      productId,
      artifactsDeleted: 2,
      bytesDeleted: 42,
    });
    output.mockRestore();
  });
});
