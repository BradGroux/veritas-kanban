import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  CODEX_APP_SERVER_CERTIFIED_VERSION,
  CodexAppServerRpcClient,
  buildCodexAppServerArgs,
  buildSafeCodexAppServerEnv,
  classifyCodexAppServerNotification,
  parseCodexAppServerLine,
  type CodexAppServerTerminalResult,
} from '../services/codex-app-server-adapter.js';

const execFileAsync = promisify(execFile);
const smokeEnabled = process.env.VERITAS_CODEX_APP_SERVER_SMOKE === '1';

describe.runIf(smokeEnabled)('@smoke Codex app-server v0.145.0', () => {
  it(
    'runs one pinned strict-stdio turn and receives authoritative completion',
    { timeout: 120_000 },
    async () => {
      const version = await execFileAsync('codex', ['--version'], {
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 8 * 1024,
        shell: false,
      });
      expect(`${version.stdout}${version.stderr}`.trim()).toBe(CODEX_APP_SERVER_CERTIFIED_VERSION);

      const child = spawn('codex', buildCodexAppServerArgs(), {
        cwd: process.cwd(),
        env: buildSafeCodexAppServerEnv(process.env),
        shell: false,
      });
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let processing = Promise.resolve();
      let terminal: CodexAppServerTerminalResult | undefined;
      const summaries: string[] = [];
      const methods: string[] = [];
      const remoteControlStatuses: string[] = [];
      let resolveTerminal: (() => void) | undefined;
      const terminalObserved = new Promise<void>((resolve) => {
        resolveTerminal = resolve;
      });
      const rpcClient = new CodexAppServerRpcClient({
        write(line) {
          child.stdin.write(line);
        },
        requestTimeoutMs: 20_000,
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderrBuffer = `${stderrBuffer}${chunk}`.slice(-64 * 1024);
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          processing = processing.then(async () => {
            const record = parseCodexAppServerLine(line);
            const inbound = await rpcClient.acceptRecord(record);
            methods.push(inbound.method);
            if (inbound.kind !== 'notification') return;
            if (inbound.method === 'remoteControl/status/changed') {
              const params = record.params;
              if (params && typeof params === 'object' && !Array.isArray(params)) {
                const status = (params as Record<string, unknown>).status;
                if (typeof status === 'string') remoteControlStatuses.push(status);
              }
            }
            const classified = classifyCodexAppServerNotification(record);
            if (classified.summary) summaries.push(classified.summary);
            if (classified.terminal) {
              terminal = classified.terminal;
              resolveTerminal?.();
            }
          });
        }
      });

      try {
        await rpcClient.initialize();
        const threadId = await rpcClient.startThread({
          cwd: process.cwd(),
          sandboxMode: 'read-only',
        });
        const turnId = await rpcClient.startTurn({
          threadId,
          cwd: process.cwd(),
          prompt: 'Reply with exactly: VERITAS_CODEX_APP_SERVER_SMOKE_OK',
        });
        expect(threadId).toBeTruthy();
        expect(turnId).toBeTruthy();
        await Promise.race([
          terminalObserved,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Timed out waiting for Codex app-server turn completion.')),
              90_000
            )
          ),
        ]);
        await processing;
        expect(terminal).toMatchObject({ success: true, status: 'completed' });
        expect(summaries.join('')).toContain('VERITAS_CODEX_APP_SERVER_SMOKE_OK');
        expect(methods).toContain('remoteControl/status/changed');
        expect(remoteControlStatuses).toEqual(['disabled']);
      } finally {
        rpcClient.close();
        if (child.stdin.writable) child.stdin.end();
        await Promise.race([
          new Promise<void>((resolve) => child.once('close', () => resolve())),
          new Promise<void>((resolve) =>
            setTimeout(() => {
              if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
              resolve();
            }, 5_000)
          ),
        ]);
      }

      expect(stderrBuffer).not.toMatch(/remote control/i);
    }
  );
});
