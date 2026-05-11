import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('Codex provider runtime authority guard', () => {
  it('does not resurrect the legacy Clawdbot agent service as a direct runtime', () => {
    expect(existsSync(join(root, 'services', 'clawdbot-agent-service.ts'))).toBe(false);

    const hermesService = readFileSync(join(root, 'services', 'hermes-agent-service.ts'), 'utf8');
    expect(hermesService).toContain('HermesAgentService');
    expect(hermesService).toContain('sendGatewayRun');
    expect(hermesService).not.toContain('CLAWDBOT_GATEWAY');
    expect(hermesService).not.toContain('127.0.0.1:18789');
  });
});
