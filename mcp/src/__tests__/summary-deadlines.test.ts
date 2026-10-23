import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let server: Server;
let requests: string[];
let behavior: 'headers' | 'body' | 'success' | 'error';
const key = 'mcp-summary-fixture-key';
beforeEach(async () => {
  vi.resetModules();
  requests = [];
  behavior = 'success';
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.url === '/api/auth/context') {
      res.end(JSON.stringify({ permissions: ['report:read'] }));
      return;
    }
    if (behavior === 'headers') return;
    if (behavior === 'body') {
      res.writeHead(200);
      res.write('partial');
      return;
    }
    if (behavior === 'error') {
      res.writeHead(429, { 'retry-after': '2' });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Limited ${key}`,
            details: { password: 'private-fixture-value' },
          },
        })
      );
      return;
    }
    res.end('# Memory summary\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected fixture listener');
  vi.stubEnv('VK_API_URL', `http://127.0.0.1:${address.port}`);
  vi.stubEnv('VK_API_KEY', key);
  vi.stubEnv('VK_API_TIMEOUT_MS', '150');
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  vi.unstubAllEnvs();
});
async function run() {
  const { handleSummaryTool } = await import('../tools/summary.js');
  return handleSummaryTool('get_memory_summary', { hours: 12 });
}
describe('MCP memory summary bounded transport', () => {
  it.each(['headers', 'body'] as const)(
    'bounds a %s stall after permission preflight',
    async (stall) => {
      behavior = stall;
      const started = performance.now();
      await expect(run()).rejects.toMatchObject({ code: 'TIMEOUT' });
      expect(performance.now() - started).toBeLessThan(2_000);
      expect(requests).toEqual(['/api/auth/context', '/api/summary/memory?hours=12']);
    }
  );
  it('preserves successful markdown', async () => {
    expect(await run()).toEqual({ content: [{ type: 'text', text: '# Memory summary\n' }] });
    expect(requests).toEqual(['/api/auth/context', '/api/summary/memory?hours=12']);
  });
  it('retains safe error metadata while removing credential and private fields', async () => {
    behavior = 'error';
    const error = await run().catch((value: unknown) => value);
    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      details: { retryAfter: '2' },
    });
    expect(JSON.stringify(error)).not.toContain(key);
    expect(JSON.stringify(error)).not.toContain('private-fixture-value');
    expect(requests).toHaveLength(2);
  });
});
