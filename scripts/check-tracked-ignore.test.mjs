import assert from 'node:assert/strict';
import test from 'node:test';

import { findIgnoredTrackedFiles } from './check-tracked-ignore.mjs';

function result(status, stdout = '', stderr = '') {
  return {
    status,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    error: undefined,
  };
}

function gitRunner(responses, calls) {
  return (args, options) => {
    calls.push({ args, options });
    const response = responses.shift();
    assert.ok(response, 'unexpected Git invocation');
    return response;
  };
}

test('reports sorted tracked paths returned by check-ignore', () => {
  const calls = [];
  const tracked = 'server/src/storage/repository.ts\0server/src/__tests__/storage/example.test.ts\0';
  const ignored =
    'server/src/storage/repository.ts\0server/src/__tests__/storage/example.test.ts\0';

  assert.deepEqual(
    findIgnoredTrackedFiles(
      '/repo',
      gitRunner([result(0, tracked), result(0, ignored)], calls)
    ),
    ['server/src/__tests__/storage/example.test.ts', 'server/src/storage/repository.ts']
  );
  assert.deepEqual(calls[0], {
    args: ['ls-files', '-z'],
    options: { cwd: '/repo' },
  });
  assert.deepEqual(calls[1], {
    args: ['check-ignore', '--no-index', '-z', '--stdin'],
    options: { cwd: '/repo', input: Buffer.from(tracked) },
  });
});

test('accepts the normal check-ignore no-match exit status', () => {
  const calls = [];
  assert.deepEqual(
    findIgnoredTrackedFiles(
      '/repo',
      gitRunner([result(0, 'server/src/storage/repository.ts\0'), result(1)], calls)
    ),
    []
  );
});

test('surfaces Git command failures', () => {
  assert.throws(
    () => findIgnoredTrackedFiles('/repo', gitRunner([result(2, '', 'bad index')], [])),
    /git ls-files failed: bad index/
  );
  assert.throws(
    () =>
      findIgnoredTrackedFiles(
        '/repo',
        gitRunner([result(0, 'tracked\0'), result(128, '', 'bad ignore rules')], [])
      ),
    /git check-ignore failed: bad ignore rules/
  );
});
