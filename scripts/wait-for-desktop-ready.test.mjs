import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectMacDesktopState,
  verifyMacDesktopListener,
  waitForDesktopReady,
} from './wait-for-desktop-ready.mjs';

function createFakeClock() {
  let currentTime = 0;

  return {
    now: () => currentTime,
    sleep: async (durationMs) => {
      currentTime += durationMs;
    },
  };
}

function healthyResponse(version = '5.2.5') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      service: 'veritas-kanban',
      version,
    }),
  };
}

test('waits through connection failures until the desktop server is ready', async () => {
  const clock = createFakeClock();
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    if (requestCount < 3) {
      throw new TypeError('fetch failed');
    }
    return healthyResponse();
  };

  const result = await waitForDesktopReady({
    expectedVersion: '5.2.5',
    fetchImpl,
    healthUrl: 'http://127.0.0.1:3001/api/health',
    intervalMs: 100,
    now: clock.now,
    sleep: clock.sleep,
    timeoutMs: 1_000,
  });

  assert.equal(result.attempts, 3);
  assert.equal(result.elapsedMs, 200);
  assert.equal(result.health.version, '5.2.5');
});

test('does not accept a stale server with the wrong version', async () => {
  const clock = createFakeClock();

  await assert.rejects(
    waitForDesktopReady({
      expectedVersion: '5.2.5',
      fetchImpl: async () => healthyResponse('5.2.4'),
      healthUrl: 'http://127.0.0.1:3001/api/health',
      intervalMs: 100,
      now: clock.now,
      sleep: clock.sleep,
      timeoutMs: 250,
    }),
    /expected version 5\.2\.5 but received 5\.2\.4/
  );
});

test('does not accept a same-version server until the packaged app owns the port', async () => {
  const clock = createFakeClock();
  let ownerCheckCount = 0;

  const result = await waitForDesktopReady({
    expectedVersion: '5.2.5',
    fetchImpl: async () => healthyResponse(),
    healthUrl: 'http://127.0.0.1:3001/api/health',
    intervalMs: 100,
    now: clock.now,
    readyCheck: async () => {
      ownerCheckCount += 1;
      if (ownerCheckCount === 1) {
        throw new Error('port 3001 is owned by a source checkout');
      }
      return { classification: 'packaged-listener' };
    },
    sleep: clock.sleep,
    timeoutMs: 250,
  });

  assert.equal(result.attempts, 2);
  assert.deepEqual(result.readiness, { classification: 'packaged-listener' });
});

test('classifies a same-version writer plus desktop fallback as a competing alternate port', async () => {
  const commandRunner = async (command, args) => {
    if (command === 'lsof' && args.includes('-t')) {
      return '123\n';
    }
    if (command === 'ps') {
      return '/usr/local/bin/node /Users/operator/veritas-kanban/server/dist/index.js\n';
    }
    if (command === 'pgrep') {
      return '456\n';
    }
    if (command === 'lsof' && args.includes('-p')) {
      return 'veritas-k 456 operator TCP 127.0.0.1:43225 (LISTEN)\n';
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };

  const state = await inspectMacDesktopState({
    commandRunner,
    healthUrl: 'http://127.0.0.1:3001/api/health',
  });

  assert.equal(state.classification, 'competing-listener-with-alternate-port');
  assert.match(state.summary, /competing owner while the desktop app listens on another port/);
  await assert.rejects(
    verifyMacDesktopListener({
      commandRunner,
      healthUrl: 'http://127.0.0.1:3001/api/health',
    }),
    /competing owner while the desktop app listens on another port/
  );
});

test('distinguishes launch failure from an alternate desktop port', async () => {
  const noProcessRunner = async () => {
    throw new Error('no matching process');
  };
  const launchFailure = await inspectMacDesktopState({
    commandRunner: noProcessRunner,
    healthUrl: 'http://127.0.0.1:3001/api/health',
  });
  assert.equal(launchFailure.classification, 'launch-failure');

  const alternatePortRunner = async (command, args) => {
    if (command === 'pgrep') {
      return '456\n';
    }
    if (command === 'lsof' && args.includes('-p')) {
      return 'veritas-k 456 operator TCP 127.0.0.1:43225 (LISTEN)\n';
    }
    throw new Error('no preferred-port listener');
  };
  const alternatePort = await inspectMacDesktopState({
    commandRunner: alternatePortRunner,
    healthUrl: 'http://127.0.0.1:3001/api/health',
  });
  assert.equal(alternatePort.classification, 'alternate-port');
  assert.match(alternatePort.summary, /not on required port 3001/);
});

test('requires an expected version', async () => {
  await assert.rejects(
    waitForDesktopReady({
      fetchImpl: async () => healthyResponse(),
    }),
    /expectedVersion is required/
  );
});

test('times out with the target URL and last connection error', async () => {
  const clock = createFakeClock();

  await assert.rejects(
    waitForDesktopReady({
      expectedVersion: '5.2.5',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
      healthUrl: 'http://127.0.0.1:3001/api/health',
      intervalMs: 100,
      now: clock.now,
      sleep: clock.sleep,
      timeoutMs: 250,
    }),
    (error) => {
      assert.match(error.message, /did not become ready within 250ms/);
      assert.match(error.message, /http:\/\/127\.0\.0\.1:3001\/api\/health/);
      assert.match(error.message, /fetch failed/);
      return true;
    }
  );
});
