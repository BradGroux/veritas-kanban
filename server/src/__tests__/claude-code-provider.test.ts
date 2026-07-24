import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildClaudeCodeArgs,
  buildSafeClaudeCodeEnv,
  classifyClaudeCodeStreamRecord,
  hasClaudeCodeBareAuthentication,
  parseClaudeCodeStreamLine,
} from '../services/claude-code-adapter.js';
import { getProviderRunEventMapper } from '../services/provider-run-event-mappers.js';
import { getProviderRuntimeAdapterDefinition } from '../services/provider-runtime-adapter-registry.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/claude-code-v2.1.218.stream.jsonl', import.meta.url)
);

describe('Claude Code v2.1.218 adapter contract', () => {
  it('builds a reproducible bare-mode streaming launch with static permissions', () => {
    const args = buildClaudeCodeArgs({
      prompt: 'Complete the task.',
      model: 'claude-opus-4-6',
      sandboxMode: 'workspace-write',
      networkAccessEnabled: false,
      maxBudgetUsd: 4.25,
    });

    expect(args).toEqual(
      expect.arrayContaining([
        '--bare',
        '--print',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--include-hook-events',
        '--forward-subagent-text',
        '--permission-mode',
        'dontAsk',
        '--max-budget-usd',
        '4.25',
        '--max-turns',
        '100',
        '--model',
        'claude-opus-4-6',
      ])
    );
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args[args.length - 1]).toBe('Complete the task.');
    expect(args[args.indexOf('--allowedTools') + 1]).not.toContain('Bash');
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('WebFetch');
  });

  it('rejects launch arguments that can inherit or bypass ungoverned configuration', () => {
    for (const extraArgs of [
      ['--dangerously-skip-permissions'],
      ['--permission-prompt-tool', 'mcp__unowned__approve'],
      ['--settings', '/tmp/unowned.json'],
      ['--plugin-dir', '/tmp/plugin'],
      ['--mcp-config', '/tmp/mcp.json'],
      ['--allowedTools', 'Bash'],
    ]) {
      expect(() =>
        buildClaudeCodeArgs({
          prompt: 'task',
          sandboxMode: 'workspace-write',
          networkAccessEnabled: true,
          extraArgs,
        })
      ).toThrow(/not allowed|broker|controlled/i);
    }
  });

  it('passes only explicit Claude Code credentials and safe process context', () => {
    const source = {
      HOME: '/home/operator',
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'test-key',
      CLAUDE_CONFIG_DIR: '/home/operator/.claude',
      GITHUB_TOKEN: 'do-not-forward',
      DATABASE_URL: 'do-not-forward',
      EXTRA_SAFE: 'allowed-by-policy',
    };
    const env = buildSafeClaudeCodeEnv(source, ['EXTRA_SAFE', 'GITHUB_TOKEN']);

    expect(env).toMatchObject({
      HOME: '/home/operator',
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'test-key',
      EXTRA_SAFE: 'allowed-by-policy',
      VK_API_URL: 'http://localhost:3001',
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    });
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(hasClaudeCodeBareAuthentication(source)).toBe(true);
    expect(hasClaudeCodeBareAuthentication({ HOME: '/home/operator' })).toBe(false);
    expect(
      hasClaudeCodeBareAuthentication({
        CLAUDE_CODE_USE_FOUNDRY: '1',
        ANTHROPIC_FOUNDRY_RESOURCE: 'resource-without-credentials',
      })
    ).toBe(false);
    expect(
      hasClaudeCodeBareAuthentication({
        CLAUDE_CODE_USE_FOUNDRY: '1',
        ANTHROPIC_FOUNDRY_AUTH_TOKEN: 'foundry-token',
      })
    ).toBe(true);
    expect(
      hasClaudeCodeBareAuthentication({
        CLAUDE_CODE_USE_BEDROCK: '0',
        AWS_PROFILE: 'profile-that-must-not-be-used',
      })
    ).toBe(false);
  });

  it('parses the pinned golden stream into session, event, usage, artifact, and terminal evidence', async () => {
    const records = (await readFile(FIXTURE_PATH, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map(parseClaudeCodeStreamLine)
      .map(classifyClaudeCodeStreamRecord);

    expect(records[0]).toMatchObject({
      providerType: 'system.init',
      sessionId: '11111111-1111-4111-8111-111111111111',
    });
    expect(records[1]).toMatchObject({
      providerType: 'stream_event.content_block_delta.text_delta',
      summary: 'Inspecting the repository.',
    });
    expect(records[2]).toMatchObject({
      providerType: 'assistant.tool_use',
      tool: 'Read',
      files: ['server/src/index.ts'],
    });
    expect(records[3]).toMatchObject({
      providerType: 'user.tool_result',
      parentToolUseId: 'tool_1',
    });
    expect(records[4].providerType).toBe('system.hook_started');
    expect(records[5]).toMatchObject({
      providerType: 'assistant.subagent',
      parentToolUseId: 'agent_tool_1',
      summary: 'Subagent report.',
    });
    expect(records[6]).toMatchObject({
      providerType: 'result.success',
      terminal: {
        success: true,
        summary: 'Implemented and verified the requested change.',
      },
      usage: {
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
        cost: 0.041,
      },
    });
  });

  it('maps Claude stream semantics without discarding the raw provider record', async () => {
    const [initLine, deltaLine, toolLine, resultLine] = (await readFile(FIXTURE_PATH, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .filter((_, index) => [0, 1, 2, 6].includes(index));
    const mapper = getProviderRunEventMapper('claude-code');
    const mapped = [initLine, deltaLine, toolLine, resultLine].map((line) => {
      const record = parseClaudeCodeStreamLine(line);
      const classified = classifyClaudeCodeStreamRecord(record);
      return mapper.mapEvent(classified.providerType, record, classified.summary);
    });

    expect(mapped.map((event) => event.kind)).toEqual([
      'progress',
      'message.delta',
      'tool.started',
      'progress',
    ]);
    expect(mapped[1]).toMatchObject({
      providerEventId: 'event_delta_1',
      sessionId: '11111111-1111-4111-8111-111111111111',
    });
    expect(mapped[2].payload).toMatchObject({
      providerType: 'assistant.tool_use',
      raw: expect.objectContaining({ type: 'assistant' }),
    });
  });

  it('publishes fail-closed capabilities until shared lifecycle and approval brokers land', () => {
    const capabilities = getProviderRuntimeAdapterDefinition('claude-code').capabilities;
    const state = (id: string) => capabilities.find((capability) => capability.id === id)?.state;

    expect(state('run.start')).toBe('supported');
    expect(state('run.streaming')).toBe('supported');
    expect(state('run.structured-events')).toBe('supported');
    expect(state('usage.tokens')).toBe('supported');
    expect(state('run.resume')).toBe('advisory');
    expect(state('run.approvals')).toBe('unsupported');
    expect(state('run.elicitation')).toBe('unsupported');
    expect(state('tool.mcp')).toBe('unsupported');
  });

  it('fails malformed and truncated records closed', () => {
    expect(() => parseClaudeCodeStreamLine('not json')).toThrow(/valid JSON/i);
    expect(() => parseClaudeCodeStreamLine('{"type":"result"')).toThrow(/valid JSON/i);
    expect(() => parseClaudeCodeStreamLine('[]')).toThrow(/object/i);
    expect(() => parseClaudeCodeStreamLine(JSON.stringify({ no_type: true }))).toThrow(/type/i);
    expect(() =>
      parseClaudeCodeStreamLine(
        JSON.stringify({ type: 'system', payload: 'x'.repeat(1024 * 1024) })
      )
    ).toThrow(/1 MiB/i);
    expect(() =>
      buildClaudeCodeArgs({
        prompt: 'task',
        sandboxMode: 'workspace-write',
        networkAccessEnabled: true,
        extraArgs: ['--effort', 'ultracode'],
      })
    ).toThrow(/not supported/i);
  });

  it('drops oversized or control-bearing provider identifiers and artifact paths', () => {
    const classified = classifyClaudeCodeStreamRecord({
      type: 'assistant',
      session_id: `session-${'x'.repeat(300)}`,
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Read\nInjected heading',
            input: { file_path: 'server/src/index.ts\nInjected log content' },
          },
        ],
      },
    });

    expect(classified.providerType).toBe('assistant.tool_use');
    expect(classified.sessionId).toBeUndefined();
    expect(classified.tool).toBeUndefined();
    expect(classified.files).toEqual([]);
  });
});
