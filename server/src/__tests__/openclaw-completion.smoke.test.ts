/** @smoke OpenClaw 2026.9.2: real child runs, isolated gateway, deterministic local model. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { normalizeOpenClawTerminal } from '../services/openclaw-completion-service.js';
import { startOpenClawCompletionFixture } from './fixtures/openclaw-completion-gateway.js';

describe.skipIf(process.env.VK_OPENCLAW_SMOKE !== '1')(
  'native OpenClaw completion @smoke v2026.9.2',
  () => {
    let fixture: Awaited<ReturnType<typeof startOpenClawCompletionFixture>>;
    beforeAll(async () => {
      fixture = await startOpenClawCompletionFixture();
    }, 60_000);
    afterAll(async () => {
      await fixture?.close();
    });
    it.each(['success', 'failed'] as const)(
      'captures an actual child %s terminal result without a callback',
      async (status) => {
        const spawned = await fixture.adapter.spawnTask({
          taskId: `task-${status}`,
          attemptId: randomUUID(),
          agentId: 'openclaw',
          prompt: `Reply with the completion JSON only. ${status === 'failed' ? 'FIXTURE_OUTCOME_FAILED' : 'FIXTURE_OUTCOME_SUCCESS'}`,
          timeoutSeconds: 60,
        });
        expect(spawned.runId).toBeTruthy();
        expect(spawned.sessionKey).toContain('subagent');
        let claim = null;
        for (let index = 0; index < 10 && !claim; index++) {
          const observed = await fixture.adapter.waitForRun(spawned.runId, 5_000);
          claim = normalizeOpenClawTerminal(observed.result);
        }
        expect(claim, JSON.stringify(claim)).toMatchObject({
          terminalSource: 'remote-session',
          status,
          summary: 'Isolated native child completed',
        });
        expect(fixture.modelCalls).toBeGreaterThan(0);
        // A new server connection recovers the same terminal result using only the saved run ID.
        const recovered = await fixture.adapter.waitForRun(spawned.runId, 0);
        expect(normalizeOpenClawTerminal(recovered.result)).toEqual(claim);
      },
      60_000
    );
  }
);
