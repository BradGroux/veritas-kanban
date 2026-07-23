#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleepWithTimer } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_HEALTH_URL = 'http://127.0.0.1:3001/api/health';
const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAC_APP_CONTENTS_PREFIX = '/Applications/Veritas Kanban.app/Contents/';
const execFile = promisify(execFileCallback);

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function healthError(response, payload, expectedVersion) {
  if (!response.ok) {
    return new Error(`health endpoint returned HTTP ${response.status}`);
  }
  if (!payload || typeof payload !== 'object') {
    return new Error('health endpoint did not return a JSON object');
  }
  if (payload.ok !== true || payload.service !== 'veritas-kanban') {
    return new Error('health endpoint did not identify a ready Veritas Kanban server');
  }
  if (typeof payload.version !== 'string' || payload.version.length === 0) {
    return new Error('health endpoint did not report a version');
  }
  if (payload.version !== expectedVersion) {
    return new Error(`expected version ${expectedVersion} but received ${payload.version}`);
  }
  return null;
}

async function defaultCommandRunner(command, args) {
  const result = await execFile(command, args, { encoding: 'utf8' });
  return result.stdout;
}

async function commandOutput(commandRunner, command, args) {
  try {
    return (await commandRunner(command, args)).trim();
  } catch {
    return '';
  }
}

function healthPort(healthUrl) {
  const parsedUrl = new globalThis.URL(healthUrl);
  return parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
}

export async function inspectMacDesktopState(options = {}) {
  const healthUrl = options.healthUrl ?? DEFAULT_HEALTH_URL;
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const port = healthPort(healthUrl);
  const portPidsOutput = await commandOutput(commandRunner, 'lsof', [
    '-nP',
    '-t',
    `-iTCP:${port}`,
    '-sTCP:LISTEN',
  ]);
  const portPids = portPidsOutput.split(/\s+/).filter(Boolean);
  const portCommands =
    portPids.length > 0
      ? await commandOutput(commandRunner, 'ps', ['-o', 'command=', '-p', portPids.join(',')])
      : '';
  const packagedPortOwner = portCommands
    .split('\n')
    .some((command) => command.includes(MAC_APP_CONTENTS_PREFIX));

  const desktopPidsOutput = await commandOutput(commandRunner, 'pgrep', [
    '-f',
    MAC_APP_CONTENTS_PREFIX,
  ]);
  const desktopPids = desktopPidsOutput.split(/\s+/).filter(Boolean);
  const desktopListeners = [];

  for (const pid of desktopPids) {
    const listeners = await commandOutput(commandRunner, 'lsof', [
      '-nP',
      '-a',
      '-p',
      pid,
      '-iTCP',
      '-sTCP:LISTEN',
    ]);
    if (listeners) {
      desktopListeners.push(listeners);
    }
  }

  if (packagedPortOwner) {
    return {
      classification: 'packaged-listener',
      desktopListeners,
      port,
      portCommands,
      summary: `the packaged desktop server owns port ${port}`,
    };
  }

  if (portPids.length > 0 && desktopListeners.length > 0) {
    return {
      classification: 'competing-listener-with-alternate-port',
      desktopListeners,
      port,
      portCommands,
      summary: `port ${port} has a competing owner while the desktop app listens on another port`,
    };
  }

  if (portPids.length > 0) {
    return {
      classification: 'competing-listener',
      desktopListeners,
      port,
      portCommands,
      summary: `port ${port} is owned by a process outside /Applications/Veritas Kanban.app`,
    };
  }

  if (desktopListeners.length > 0) {
    return {
      classification: 'alternate-port',
      desktopListeners,
      port,
      portCommands,
      summary: `the desktop app is listening, but not on required port ${port}`,
    };
  }

  if (desktopPids.length > 0) {
    return {
      classification: 'desktop-not-listening',
      desktopListeners,
      port,
      portCommands,
      summary: 'the desktop app is running but has no listening server process',
    };
  }

  return {
    classification: 'launch-failure',
    desktopListeners,
    port,
    portCommands,
    summary: 'no packaged desktop process is running',
  };
}

export async function verifyMacDesktopListener(options = {}) {
  if (process.platform !== 'darwin' && !options.commandRunner) {
    throw new Error('packaged desktop listener verification requires macOS');
  }

  const state = await inspectMacDesktopState(options);
  if (state.classification !== 'packaged-listener') {
    throw new Error(state.summary);
  }
  return state;
}

export async function waitForDesktopReady(options = {}) {
  const healthUrl = options.healthUrl ?? DEFAULT_HEALTH_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const expectedVersion = options.expectedVersion;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const readyCheck = options.readyCheck ?? (async () => undefined);
  const sleep = options.sleep ?? ((durationMs) => sleepWithTimer(durationMs));

  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }
  if (typeof expectedVersion !== 'string' || expectedVersion.trim().length === 0) {
    throw new Error('expectedVersion is required.');
  }
  positiveInteger(timeoutMs, 'timeoutMs');
  positiveInteger(intervalMs, 'intervalMs');
  positiveInteger(requestTimeoutMs, 'requestTimeoutMs');

  const parsedUrl = new globalThis.URL(healthUrl);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('healthUrl must use http or https.');
  }

  const startedAt = now();
  let attempts = 0;
  let lastError = new Error('no health request completed');

  while (now() - startedAt <= timeoutMs) {
    attempts += 1;
    const elapsedBeforeRequest = now() - startedAt;
    const remainingMs = Math.max(1, timeoutMs - elapsedBeforeRequest);
    const signal = globalThis.AbortSignal.timeout(Math.min(requestTimeoutMs, remainingMs));

    try {
      const response = await fetchImpl(healthUrl, {
        headers: { Accept: 'application/json' },
        signal,
      });
      const payload = await response.json();
      const validationError = healthError(response, payload, expectedVersion);

      if (!validationError) {
        const readiness = await readyCheck({ healthUrl, health: payload });
        return {
          attempts,
          elapsedMs: now() - startedAt,
          health: payload,
          healthUrl,
          readiness,
        };
      }
      lastError = validationError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    const elapsedMs = now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      break;
    }
    await sleep(Math.min(intervalMs, timeoutMs - elapsedMs));
  }

  throw new Error(
    `Veritas Kanban did not become ready within ${timeoutMs}ms at ${healthUrl}. Last error: ${lastError.message}`
  );
}

function usage() {
  console.log(`Usage: node scripts/wait-for-desktop-ready.mjs [options]

Wait until a desktop Veritas Kanban server reports healthy.

Options:
  --url <url>                    Health URL. Defaults to ${DEFAULT_HEALTH_URL}
  --expected-version <version>   Required. Exact version the server must report.
  --timeout-ms <milliseconds>    Total wait time. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --interval-ms <milliseconds>   Delay between attempts. Defaults to ${DEFAULT_INTERVAL_MS}.
  --request-timeout-ms <ms>      Timeout for one health request. Defaults to ${DEFAULT_REQUEST_TIMEOUT_MS}.
  --help                         Show this help text.
`);
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      usage();
      return null;
    }

    const [flag, inlineValue] = argument.split('=', 2);
    const nextValue = inlineValue ?? argv[index + 1];
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`${flag} requires a value.`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }

    if (flag === '--url') {
      options.healthUrl = nextValue;
    } else if (flag === '--expected-version') {
      options.expectedVersion = nextValue;
    } else if (flag === '--timeout-ms') {
      options.timeoutMs = positiveInteger(nextValue, '--timeout-ms');
    } else if (flag === '--interval-ms') {
      options.intervalMs = positiveInteger(nextValue, '--interval-ms');
    } else if (flag === '--request-timeout-ms') {
      options.requestTimeoutMs = positiveInteger(nextValue, '--request-timeout-ms');
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }

  if (typeof options.expectedVersion !== 'string' || options.expectedVersion.length === 0) {
    throw new Error('--expected-version is required.');
  }

  return options;
}

function printFailureGuidance(error, healthUrl, desktopState) {
  const port = healthPort(healthUrl);
  console.error(`Desktop readiness check failed: ${error.message}`);
  if (desktopState) {
    console.error(`Observed desktop state: ${desktopState.summary}.`);
    if (desktopState.portCommands) {
      console.error(`Port ${port} owner:\n${desktopState.portCommands}`);
    }
    if (desktopState.desktopListeners.length > 0) {
      console.error(`Desktop listener details:\n${desktopState.desktopListeners.join('\n')}`);
    }
  }
  console.error(`
Inspect the launch before retrying:
  open -a "Veritas Kanban"
  lsof -nP -iTCP:${port} -sTCP:LISTEN
  ps -o pid,ppid,pgid,command -p "$(lsof -tiTCP:${port} -sTCP:LISTEN)"
  pgrep -ifl 'Veritas Kanban|veritas-kanban|server/dist/index.js'
  tail -n 80 "$HOME/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local/logs/server.log"

If another process owns ${port}, stop the competing writer before migration or
upgrade verification. The desktop app may choose another loopback port when its
preferred port is unavailable.`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    usage();
    process.exitCode = 1;
    return;
  }

  if (!options) {
    return;
  }

  try {
    const result = await waitForDesktopReady({
      ...options,
      readyCheck: ({ healthUrl }) => verifyMacDesktopListener({ healthUrl }),
    });
    console.log(
      `Desktop ready: version ${result.health.version} at ${result.healthUrl} after ${result.attempts} attempt(s) (${result.elapsedMs}ms); packaged app owns the port.`
    );
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    const healthUrl = options.healthUrl ?? DEFAULT_HEALTH_URL;
    const desktopState =
      process.platform === 'darwin' ? await inspectMacDesktopState({ healthUrl }) : undefined;
    printFailureGuidance(resolvedError, healthUrl, desktopState);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
