#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseProcessSnapshot(text) {
  const processes = new Map();
  for (const line of text.trim().split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    processes.set(pid, { pid, parentPid: Number(match[2]), started: match[3], command: match[4] });
  }
  return processes;
}

function sourcePath(value, cwd) {
  try {
    return value.startsWith('file:') ? fileURLToPath(value) : path.resolve(cwd, value);
  } catch {
    return '';
  }
}

export function isDevCommand(command, cwd, repoRoot) {
  const tokens = command.trim().split(/\s+/);
  let executable = path.basename(tokens.shift() ?? '');
  if (/^node(?:js)?$/.test(executable)) {
    // tsx uses these Node loader arguments for its source-entry child.
    while (tokens[0]?.startsWith('-')) {
      const option = tokens.shift();
      if (
        [
          '--require',
          '-r',
          '--import',
          '--loader',
          '--experimental-loader',
          '--conditions',
        ].includes(option)
      )
        tokens.shift();
      else if (!['--enable-source-maps', '--no-warnings'].includes(option)) return false;
    }
    executable = tokens.shift() ?? '';
  }
  if (['pnpm', 'pnpm.cjs', 'pnpm.mjs'].includes(path.basename(executable))) {
    return (
      /^(?:run )?dev$/.test(tokens.join(' ')) ||
      /^--filter (?:server|web|@veritas-kanban\/(?:server|web)) (?:run )?dev$/.test(
        tokens.join(' ')
      )
    );
  }
  const entry = sourcePath(executable, cwd);
  if (entry === path.join(repoRoot, 'server/src/index.ts')) return true;
  const relative = path.relative(repoRoot, entry);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.includes('node_modules/'))
    return false;
  if (/(?:\/vite\/bin\/vite\.js|\/\.bin\/vite)$/.test(entry)) return true;
  if (/(?:\/tsx\/dist\/cli\.mjs|\/\.bin\/tsx)$/.test(entry)) {
    if (tokens[0] === 'watch') tokens.shift();
    return (
      tokens.length === 1 &&
      sourcePath(tokens[0], cwd) === path.join(repoRoot, 'server/src/index.ts')
    );
  }
  return (
    /(?:\/concurrently\/dist\/bin\/concurrently\.js|\/\.bin\/concurrently)$/.test(entry) &&
    command.includes('pnpm --filter server dev') &&
    command.includes('pnpm --filter web dev')
  );
}

function inspect(command, args, allowEmpty = false) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (allowEmpty && error.status === 1) return '';
    throw new Error(
      `Cannot verify development process ownership (${command}); no unverified process will be signaled.`,
      { cause: error }
    );
  }
}

const system = {
  snapshot: () => parseProcessSnapshot(inspect('ps', ['-axo', 'pid=,ppid=,lstart=,command='])),
  cwd: (pid) => {
    const record = inspect('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-F0n'], true)
      .split('\0')
      .find((field) => field.startsWith('n'));
    return record ? realpathSync(record.slice(1)) : undefined;
  },
  checkout: (cwd) => {
    // Avoid inherited Git overrides changing which checkout is being inspected.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
    );
    try {
      return realpathSync(
        execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
          encoding: 'utf8',
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim()
      );
    } catch {
      return undefined;
    }
  },
  listeners: (port) =>
    inspect('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], true)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number),
  signal: (pid) => process.kill(pid, 'SIGTERM'),
};

export function planDevCleanup(repoRoot, ports, io = system) {
  const snapshot = io.snapshot();
  const owned = new Map();
  for (const entry of snapshot.values()) {
    if (entry.pid === process.pid) continue;
    if (!/^(?:\S+\/)?(?:node|nodejs|pnpm|tsx)(?:\s|$)/.test(entry.command)) continue;
    const cwd = io.cwd(entry.pid);
    if (cwd && io.checkout(cwd) === repoRoot && isDevCommand(entry.command, cwd, repoRoot)) {
      owned.set(entry.pid, { ...entry, cwd });
    }
  }
  // Inspect every configured listener before sending any signal.
  for (const port of ports) {
    if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)
      throw new Error('Invalid development port');
    for (const pid of io.listeners(port)) {
      if (!owned.has(pid))
        throw new Error(
          `Port ${port} belongs to unverified PID ${pid}; stop its owner or choose another port. No processes were signaled.`
        );
    }
  }
  // Stop known parents first so watchers cannot restart their source children.
  const depth = (entry) => {
    const seen = new Set();
    while (snapshot.has(entry.parentPid) && !seen.has(entry.parentPid)) {
      seen.add(entry.parentPid);
      entry = snapshot.get(entry.parentPid);
    }
    return seen.size;
  };
  return [...owned.values()].sort((a, b) => depth(a) - depth(b));
}

export function applyDevCleanup(repoRoot, plan, io = system) {
  let signaled = 0;
  for (const expected of plan) {
    const current = io.snapshot().get(expected.pid);
    if (!current) continue;
    const cwd = io.cwd(expected.pid);
    if (
      current.started !== expected.started ||
      current.command !== expected.command ||
      cwd !== expected.cwd ||
      io.checkout(cwd) !== repoRoot ||
      !isDevCommand(current.command, cwd, repoRoot)
    ) {
      throw new Error(
        `PID ${expected.pid} changed identity or checkout; cleanup stopped without signaling that process.`
      );
    }
    try {
      io.signal(expected.pid);
      signaled += 1;
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  return signaled;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Expected API and web ports');
    const root = realpathSync(path.resolve(import.meta.dirname, '..'));
    const plan = planDevCleanup(root, process.argv.slice(2));
    const signaled = applyDevCleanup(root, plan);
    console.log(`[dev-clean] sent SIGTERM to ${signaled} verified checkout dev runners`);
  } catch (error) {
    console.error(`[dev-clean] ${error.message}`);
    process.exitCode = 1;
  }
}
