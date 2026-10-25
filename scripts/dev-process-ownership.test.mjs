import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDevCleanup,
  isDevCommand,
  parseProcessSnapshot,
  planDevCleanup,
} from './dev-process-ownership.mjs';

const root = '/checkout/veritas-kanban';
const processEntry = (pid, command, parentPid = 1) => ({
  pid,
  parentPid,
  command,
  started: 'Thu Oct 22 20:00:00 2026',
});
const vite = processEntry(42, `node ${root}/web/node_modules/vite/bin/vite.js --port 3000`);
const tsx = processEntry(
  43,
  `node ${root}/server/node_modules/tsx/dist/cli.mjs watch src/index.ts`
);

function fixture(entries = [vite, tsx]) {
  const snapshot = new Map(entries.map((entry) => [entry.pid, entry]));
  const signals = [];
  return {
    snapshot: () => snapshot,
    cwd: (pid) => `${root}/${pid === 43 ? 'server' : 'web'}`,
    checkout: () => root,
    listeners: (port) => [Number(port) === 3000 ? 42 : 43],
    signal: (pid) => signals.push(pid),
    signals,
  };
}

test('recognizes exact source runners and rejects unknown commands', () => {
  assert(isDevCommand(vite.command, `${root}/web`, root));
  assert(isDevCommand(tsx.command, `${root}/server`, root));
  assert(
    isDevCommand(
      `node --require ${root}/node_modules/tsx/dist/preflight.cjs --import file://${root}/node_modules/tsx/dist/loader.mjs src/index.ts`,
      `${root}/server`,
      root
    )
  );
  assert(isDevCommand('node /global/pnpm.cjs --filter server dev', root, root));
  assert(!isDevCommand('node /global/pnpm.cjs dev:clean', root, root));
  assert(!isDevCommand('node unrelated.js', root, root));
  assert(!isDevCommand(`node -e console.log('${root}/server/src/index.ts')`, root, root));
  assert(!isDevCommand(`node /another-worktree/node_modules/vite/bin/vite.js`, root, root));
});

test('plans only verified runners and signals their exact identities', () => {
  const io = fixture();
  const plan = planDevCleanup(root, [3000, 3001], io);
  assert.equal(applyDevCleanup(root, plan, io), 2);
  assert.deepEqual(io.signals, [42, 43]);
});

test('recognizes the shared watcher only in its exact checkout and mode', () => {
  const command = `node ${root}/shared/node_modules/typescript/bin/tsc --watch --preserveWatchOutput`;
  assert(isDevCommand(command, `${root}/shared`, root));
  assert(isDevCommand('node /global/pnpm.cjs --filter @veritas-kanban/shared dev', root, root));
  assert(!isDevCommand(command, `${root}/server`, root));
  assert(
    !isDevCommand(
      command.replace('--watch --preserveWatchOutput', '--noEmit'),
      `${root}/shared`,
      root
    )
  );
  assert(!isDevCommand(command.replace(root, '/another-checkout'), `${root}/shared`, root));
  const entry = processEntry(44, command);
  const io = { ...fixture([entry]), cwd: () => `${root}/shared`, listeners: () => [] };
  const plan = planDevCleanup(root, [3000, 3001], io);
  assert.equal(applyDevCleanup(root, plan, io), 1);
  assert.deepEqual(io.signals, [44]);
});

test('foreign listener, another checkout and unknown command abort before every signal', () => {
  for (const change of [
    { listeners: () => [999] },
    { checkout: () => '/another-worktree' },
    { snapshot: () => new Map([[42, processEntry(42, 'node unrelated.js')]]) },
  ]) {
    const io = Object.assign(fixture(), change);
    assert.throws(() => planDevCleanup(root, [3000, 3001], io), /unverified/);
    assert.deepEqual(io.signals, []);
  }
});

test('PID reuse, changed command and changed cwd fail closed at signaling', () => {
  for (const change of [
    { snapshot: () => new Map([[42, { ...vite, started: 'Thu Oct 22 20:01:00 2026' }]]) },
    { snapshot: () => new Map([[42, { ...vite, command: 'node unrelated.js' }]]) },
    { cwd: () => '/another-worktree/web' },
  ]) {
    const io = fixture([vite]);
    const plan = planDevCleanup(root, [3000], io);
    Object.assign(io, change);
    assert.throws(() => applyDevCleanup(root, plan, io), /changed identity or checkout/);
    assert.deepEqual(io.signals, []);
  }
});

test('stops verified parents before their source children and ignores exited PIDs', () => {
  const io = fixture([
    { ...tsx, pid: 43 },
    { ...vite, parentPid: 43 },
  ]);
  const plan = planDevCleanup(root, [3000, 3001], io);
  assert.deepEqual(
    plan.map((entry) => entry.pid),
    [43, 42]
  );
  io.snapshot = () => new Map();
  assert.equal(applyDevCleanup(root, plan, io), 0);
  assert.deepEqual(io.signals, []);
});

test('parses process start identity and parent without printing command contents', () => {
  const result = parseProcessSnapshot(
    ` 42 1 Thu Oct 22 20:00:00 2026 ${vite.command}\nmalformed row`
  );
  assert.deepEqual(result.get(42), vite);
  assert.equal(result.size, 1);
});
