import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtureKey = 'client-body-fixture-key';
const artifact = Buffer.from('artifact bytes');
const digest = createHash('sha256').update(artifact).digest('hex');
const exit = new Error('Fixture CLI exit');
let server: Server;
let root: string;
let behavior: 'headers' | 'body' | 'success' | 'error';
let requests: string[];
let output: ReturnType<typeof vi.spyOn>;
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  vi.resetModules();
  root = await mkdtemp(path.join(os.tmpdir(), 'veritas-client-body-'));
  requests = [];
  behavior = 'success';
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw exit;
  });
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.url === '/api/auth/context') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ permissions: ['report:read', 'work_product:read'], role: 'admin' }));
      return;
    }
    if (behavior === 'headers') return;
    if (behavior === 'error') {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2' });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Limited ${fixtureKey}`,
            details: { password: 'private-fixture-value' },
          },
        })
      );
      return;
    }
    if (behavior === 'body') {
      res.writeHead(200);
      res.write('partial');
      return;
    }
    if (req.url?.includes('/artifact/download')) {
      res.writeHead(200, { 'x-artifact-sha256': digest, 'content-digest': 'fixture-digest' });
      res.end(artifact);
    } else res.end('# Fixture summary\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected fixture listener');
  vi.stubEnv('VK_API_URL', `http://127.0.0.1:${address.port}`);
  vi.stubEnv('VK_API_KEY', fixtureKey);
  vi.stubEnv('VK_API_TIMEOUT_MS', '150');
  // Establish healthy transport before injecting a response stall. The command
  // still performs its own preflight, which remains part of the two requests below.
  const healthy = await fetch(`http://127.0.0.1:${address.port}/api/auth/context`, {
    signal: AbortSignal.timeout(2_000),
  });
  expect(healthy.ok).toBe(true);
  await healthy.arrayBuffer();
  requests.length = 0;
  process.exitCode = 0;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
});

const targets = ['standup', 'memory', 'artifact'] as const;
async function run(target: (typeof targets)[number]) {
  const program = new Command().exitOverride();
  const args = ['node', 'vk'];
  if (target === 'artifact') {
    const { registerWorkProductCommands } = await import('../commands/work-products.js');
    registerWorkProductCommands(program);
    args.push(
      'work-products',
      'download',
      'wp_fixture',
      '--output',
      path.join(root, 'artifact.bin'),
      '--json'
    );
  } else {
    const { registerSummaryCommands } = await import('../commands/summary.js');
    registerSummaryCommands(program);
    args.push(
      ...(target === 'standup'
        ? ['summary', 'standup', '--date', '2026-10-22']
        : ['memory', '--hours', '12'])
    );
  }
  try {
    await program.parseAsync(args);
  } catch (error) {
    if (error !== exit) throw error;
  }
}

describe('real CLI text/binary callers', () => {
  it.each(targets.flatMap((target) => ['headers', 'body'].map((stall) => ({ target, stall }))))(
    'bounds $target through a $stall stall after successful preflight',
    async ({ target, stall }) => {
      behavior = stall as 'headers' | 'body';
      const started = performance.now();
      await run(target);
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('Request exceeded 150 ms'));
      expect(performance.now() - started).toBeLessThan(2_000);
      expect(requests[0]).toBe('/api/auth/context');
      expect(requests).toHaveLength(2);
      if (target === 'artifact')
        await expect(readFile(path.join(root, 'artifact.bin'))).rejects.toThrow();
    }
  );

  it.each(targets)('preserves successful $target output', async (target) => {
    await run(target);
    if (target === 'artifact') {
      expect(await readFile(path.join(root, 'artifact.bin'))).toEqual(artifact);
      expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
        sha256: digest,
        byteSize: artifact.byteLength,
        contentDigest: 'fixture-digest',
      });
    } else expect(output).toHaveBeenCalledWith('# Fixture summary\n');
    expect(requests).toHaveLength(2);
  });

  it.each(targets)('uses safe structured errors for $target', async (target) => {
    behavior = 'error';
    await run(target);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Limited [redacted]'));
    expect(requests).toHaveLength(2);
  });
});
