import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HANDLE = `vkbridge_${'h'.repeat(43)}`;
const runtimePath = fileURLToPath(new URL('../../runtime/run-tool-bridge.mjs', import.meta.url));
const children: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

describe('run tool bridge runtime', () => {
  it('serves the narrow MCP contract and derives run identity from its opaque header', async () => {
    const requests: Array<{
      method?: string;
      url?: string;
      header?: string;
      body?: Record<string, unknown>;
    }> = [];
    const api = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        requests.push({
          method: request.method,
          url: request.url,
          header: request.headers['x-vk-run-tool-bridge'] as string | undefined,
          ...(body ? { body: JSON.parse(body) as Record<string, unknown> } : {}),
        });
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify(
            request.url?.endsWith('/catalog')
              ? { digest: 'catalog-digest' }
              : { success: true, data: { operationId: 'operation-1', content: 'found' } }
          )
        );
      });
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    const port = (api.address() as AddressInfo).port;
    const child = spawn(process.execPath, [runtimePath], {
      cwd: path.dirname(runtimePath),
      env: {
        VK_API_URL: `http://127.0.0.1:${port}`,
        VK_RUN_TOOL_BRIDGE_HANDLE: HANDLE,
      },
      shell: false,
    });
    children.push(child);
    const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    const lines: Array<(value: Record<string, unknown>) => void> = [];
    output.on('line', (line) => {
      lines.shift()?.(JSON.parse(line) as Record<string, unknown>);
    });
    const rpc = (record: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve) => {
        lines.push(resolve);
        child.stdin.write(`${JSON.stringify(record)}\n`);
      });

    const initialized = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });
    expect(initialized).toMatchObject({
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'veritas-run-tools' },
      },
    });
    const listed = await rpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    expect(
      (listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)
    ).toEqual(['get_run_tool_catalog', 'call_run_tool']);

    await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_run_tool_catalog', arguments: {} },
    });
    const called = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'call_run_tool',
        arguments: {
          serverId: 'github-tools',
          tool: 'search',
          arguments: { query: 'roadmap' },
          operationId: 'operation-1',
        },
      },
    });
    expect(called).toMatchObject({
      result: {
        content: [
          {
            type: 'text',
            text: expect.stringContaining('operation-1'),
          },
        ],
      },
    });
    expect(requests).toEqual([
      {
        method: 'GET',
        url: '/api/run-tool-bridge/catalog',
        header: HANDLE,
      },
      {
        method: 'POST',
        url: '/api/run-tool-bridge/call',
        header: HANDLE,
        body: {
          serverId: 'github-tools',
          tool: 'search',
          arguments: { query: 'roadmap' },
          operationId: 'operation-1',
        },
      },
    ]);
    expect(JSON.stringify(requests)).not.toContain('taskId');
    expect(JSON.stringify(requests)).not.toContain('attemptId');

    child.stdin.end();
    await new Promise<void>((resolve) => child.once('close', () => resolve()));
    await new Promise<void>((resolve, reject) =>
      api.close((error) => (error ? reject(error) : resolve()))
    );
  });
});
