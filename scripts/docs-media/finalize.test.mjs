import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeCapture } from './finalize.mjs';

test('cleanup attempts every resource and persists the original and cleanup failures', async () => {
  const report = { status: 'failed', error: 'original input failure' };
  const calls = [];
  const failures = await finalizeCapture({
    report,
    resources: [
      [
        'browser',
        async () => {
          calls.push('browser');
          throw new Error('browser close failed');
        },
      ],
      [
        'app',
        async () => {
          calls.push('app');
          throw new Error('app close failed');
        },
      ],
    ],
    persist: async () => {
      calls.push('persist');
      assert(report.completedAt);
    },
  });
  assert.deepEqual(calls, ['browser', 'app', 'persist']);
  assert.equal(report.error, 'original input failure');
  assert.equal(failures.length, 2);
  assert.equal(report.status, 'failed');
});

test('cleanup failure invalidates captured status; persistence failure still closes resources', async () => {
  const report = { status: 'captured' };
  let closed = false;
  await assert.rejects(
    finalizeCapture({
      report,
      resources: [
        [
          'app',
          async () => {
            closed = true;
            throw new Error('close failed');
          },
        ],
      ],
      persist: async () => {
        throw new Error('disk unavailable');
      },
    }),
    /disk unavailable/
  );
  assert(closed);
  assert.equal(report.status, 'failed');
});
