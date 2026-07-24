import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  buildClaudeCodeArgs,
  buildSafeClaudeCodeEnv,
  CLAUDE_CODE_CERTIFIED_VERSION,
  classifyClaudeCodeStreamRecord,
  hasClaudeCodeBareAuthentication,
  parseClaudeCodeStreamLine,
} from '../services/claude-code-adapter.js';

const execFileAsync = promisify(execFile);
const smokeEnabled = process.env.VERITAS_CLAUDE_CODE_SMOKE === '1';

describe.runIf(smokeEnabled)('@smoke Claude Code v2.1.218', () => {
  it(
    'runs one pinned bare-mode stream and returns an authoritative result',
    { timeout: 120_000 },
    async () => {
      expect(hasClaudeCodeBareAuthentication(process.env)).toBe(true);
      const version = await execFileAsync('claude', ['--version'], {
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 8 * 1024,
        shell: false,
      });
      expect(`${version.stdout}${version.stderr}`.trim()).toBe(CLAUDE_CODE_CERTIFIED_VERSION);

      const args = buildClaudeCodeArgs({
        prompt: 'Reply with exactly: VERITAS_CLAUDE_CODE_SMOKE_OK',
        sandboxMode: 'read-only',
        networkAccessEnabled: false,
        maxBudgetUsd: 0.25,
        extraArgs: ['--max-turns', '1'],
      });
      const result = await execFileAsync('claude', args, {
        encoding: 'utf8',
        timeout: 90_000,
        maxBuffer: 8 * 1024 * 1024,
        shell: false,
        env: buildSafeClaudeCodeEnv(process.env),
      });
      const records = String(result.stdout)
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map(parseClaudeCodeStreamLine)
        .map(classifyClaudeCodeStreamRecord);
      const terminal = records.find((record) => record.terminal)?.terminal;

      expect(terminal).toMatchObject({
        success: true,
        subtype: 'success',
      });
      expect(terminal?.summary).toContain('VERITAS_CLAUDE_CODE_SMOKE_OK');
    }
  );
});
