import { readFile, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createApiClient, encodeApiPathSegment, formatApiError } from '../shared/dist/index.js';

const kinds = ['sprints', 'agents', 'tasks', 'chat', 'telemetry'];
function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function apiBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Demo API URL is invalid.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Demo API URL must use HTTP(S) without credentials, query or fragment.');
  return url.toString().replace(/\/+$/, '');
}
async function readState(filename, apiUrl) {
  let state;
  try {
    state = JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT')
      return {
        schemaVersion: 'demo-seed/v1',
        apiUrl,
        records: Object.fromEntries(kinds.map((kind) => [kind, {}])),
      };
    throw new Error(
      'Demo seed state is unreadable or invalid. Preserve it and review the dedicated demo volume before retrying.',
      { cause: error }
    );
  }
  if (
    !record(state) ||
    state.schemaVersion !== 'demo-seed/v1' ||
    state.apiUrl !== apiUrl ||
    !record(state.records) ||
    Object.keys(state.records).sort().join() !== [...kinds].sort().join() ||
    kinds.some(
      (kind) =>
        !record(state.records[kind]) ||
        Object.values(state.records[kind]).some((id) => typeof id !== 'string' || !id)
    )
  )
    throw new Error(
      'Demo seed state has an unsupported shape or belongs to another API. It was preserved.'
    );
  return state;
}
async function saveState(filename, state) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(state, null, 2) + '\n');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filename);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}
function array(value, name) {
  if (!Array.isArray(value))
    throw new Error(`Unexpected ${name} readback. No completion is claimed.`);
  return value;
}
function matches(value, expected) {
  return Object.entries(expected).every(([key, field]) => {
    if (Array.isArray(field))
      return (
        Array.isArray(value[key]) &&
        value[key].length === field.length &&
        field.every((entry, index) =>
          record(entry)
            ? record(value[key][index]) && matches(value[key][index], entry)
            : value[key][index] === entry
        )
      );
    if (record(field)) return record(value[key]) && matches(value[key], field);
    return value[key] === field;
  });
}

export async function seedDemo({
  apiUrl = process.env.API_URL ?? 'http://vk-demo:3001',
  adminKey = process.env.ADMIN_KEY ?? 'demo-admin-key-2026',
  stateFile = path.resolve('demo-seed-state.json'),
  readinessMs = 60_000,
} = {}) {
  const base = apiBase(apiUrl);
  const state = await readState(stateFile, base);
  const api = createApiClient(base, adminKey);
  const until = Date.now() + readinessMs;
  let ready = false;
  while (Date.now() < until) {
    try {
      await api('/api/health', { timeoutMs: Math.max(1, Math.min(2_000, until - Date.now())) });
      ready = true;
      break;
    } catch {
      if (Date.now() < until) await delay(Math.min(2_000, until - Date.now()));
    }
  }
  if (!ready) throw new Error('Demo API did not become ready within its startup deadline.');
  const fixtures = JSON.parse(
    await readFile(new URL('./seed-fixtures.json', import.meta.url), 'utf8')
  );
  const byPath = (route) =>
    fixtures.filter((entry) => entry.path === route).map((entry) => entry.body);
  const [sprints, agents, tasks, chat, telemetry] = await Promise.all([
    api('/api/sprints'),
    api('/api/agents/register'),
    api('/api/tasks'),
    api('/api/chat/squad?limit=10000'),
    api('/api/telemetry/events?limit=10000'),
  ]);
  const lists = Object.fromEntries(
    [sprints, agents, tasks, chat, telemetry].map((value, index) => [
      kinds[index],
      array(value, kinds[index]),
    ])
  );
  let created = 0;
  const expectations = Object.fromEntries(kinds.map((kind) => [kind, {}]));
  async function ensure(kind, key, route, payload, identity, expected = payload) {
    const savedId = state.records[kind][key];
    if (!savedId) expectations[kind][key] = expected;
    const candidates = savedId
      ? lists[kind].filter((item) => item.id === savedId)
      : lists[kind].filter(identity);
    if (candidates.length > 1 || (savedId && candidates.length !== 1))
      throw new Error(
        `Demo ${kind}/${key} has missing or ambiguous retained records. Preserve the demo data and review or reset its dedicated volume.`
      );
    let value = candidates[0];
    if (value && !savedId && !matches(value, expected))
      throw new Error(
        `Existing demo ${kind}/${key} uses a different or legacy payload. It was preserved; review or reset the dedicated demo volume.`
      );
    if (!value) {
      value = await api(route, { method: 'POST', body: JSON.stringify(payload) });
      if (!record(value) || typeof value.id !== 'string' || !value.id || !matches(value, expected))
        throw new Error(`Demo ${kind}/${key} did not return the expected persisted record.`);
      lists[kind].push(value);
      created += 1;
    }
    encodeApiPathSegment(value.id);
    state.records[kind][key] = value.id;
    await saveState(stateFile, state);
    return value.id;
  }
  const sprintByTask = new Map();
  for (const fixture of byPath('/api/sprints')) {
    const payload = {
      label: fixture.name,
      description: `${fixture.startDate} to ${fixture.endDate}\n${fixture.goals.join('\n')}`,
    };
    const id = await ensure(
      'sprints',
      fixture.id,
      '/api/sprints',
      payload,
      (item) => item.label === fixture.name
    );
    for (const taskId of fixture.taskIds) sprintByTask.set(taskId, id);
  }
  for (const fixture of byPath('/api/agents')) {
    const id = `demo_${fixture.name.toLowerCase()}`;
    const payload = {
      id,
      name: fixture.name,
      model: fixture.model,
      capabilities: fixture.capabilities.map((name) => ({ name })),
      metadata: { description: fixture.description, demoSeed: true },
    };
    await ensure('agents', id, '/api/agents/register', payload, (item) => item.id === id);
  }
  const taskIds = {};
  for (const fixture of byPath('/api/tasks')) {
    const payload = {
      title: fixture.title,
      type: fixture.type,
      priority: fixture.priority,
      project: fixture.project,
      description: fixture.description,
      status: fixture.status === 'open' ? 'todo' : fixture.status,
      ...(sprintByTask.has(fixture.id) ? { sprint: sprintByTask.get(fixture.id) } : {}),
      ...(fixture.subtasks
        ? {
            subtasks: fixture.subtasks.map(({ id, title, done }) => ({
              id,
              title,
              completed: done,
              created: new Date().toISOString(),
            })),
          }
        : {}),
    };
    // The API sanitizes task descriptions; fixtures record any changed persisted text.
    const expected = {
      ...payload,
      description: fixture.expectedDescription ?? payload.description,
    };
    // Creation timestamps differ when recovering a committed write whose acknowledgement was lost.
    if (expected.subtasks)
      expected.subtasks = expected.subtasks.map(({ id, title, completed }) => ({
        id,
        title,
        completed,
      }));
    taskIds[fixture.id] = await ensure(
      'tasks',
      fixture.id,
      '/api/tasks',
      payload,
      (item) => item.title === fixture.title && item.project === fixture.project,
      expected
    );
  }
  function replaceTaskIds(value) {
    let result = value;
    for (const [key, id] of Object.entries(taskIds)) result = result.replaceAll(key, id);
    return result;
  }
  for (const [index, fixture] of byPath('/api/chat/squad').entries()) {
    const payload = {
      ...fixture,
      message: replaceTaskIds(fixture.message),
      tags: fixture.tags.map((tag) => taskIds[tag] ?? tag),
    };
    const referenced = fixture.tags.find((tag) => taskIds[tag]);
    if (referenced) payload.taskId = taskIds[referenced];
    const { taskId, ...expected } = payload;
    if (taskId) expected.links = [{ taskId, label: `Task ${taskId}` }];
    await ensure(
      'chat',
      String(index),
      '/api/chat/squad',
      payload,
      (item) =>
        item.agent === fixture.agent && [fixture.message, payload.message].includes(item.message),
      expected
    );
  }
  for (const [index, fixture] of byPath('/api/telemetry/events').entries()) {
    const payload = { ...fixture, taskId: taskIds[fixture.taskId] };
    await ensure(
      'telemetry',
      String(index),
      '/api/telemetry/events',
      payload,
      (item) =>
        item.type === fixture.type &&
        item.agent === fixture.agent &&
        [fixture.taskId, payload.taskId].includes(item.taskId)
    );
  }
  // Fresh authenticated reads, not successful POSTs or task-count heuristics, establish completion.
  const verified = await Promise.all([
    api('/api/sprints'),
    api('/api/agents/register'),
    api('/api/tasks'),
    api('/api/chat/squad?limit=10000'),
    api('/api/telemetry/events?limit=10000'),
  ]);
  const counts = {};
  for (const [index, kind] of kinds.entries()) {
    const rows = array(verified[index], kind);
    for (const [key, id] of Object.entries(state.records[kind])) {
      const matching = rows.filter((item) => item.id === id);
      if (
        matching.length !== 1 ||
        (expectations[kind][key] && !matches(matching[0], expectations[kind][key]))
      )
        throw new Error(`Demo ${kind}/${key} failed authenticated completion readback.`);
    }
    counts[kind] = Object.keys(state.records[kind]).length;
  }
  const expectedCounts = { sprints: 2, agents: 4, tasks: 10, chat: 6, telemetry: 7 };
  if (!matches(counts, expectedCounts)) throw new Error('Demo fixture counts are incomplete.');
  return { created, verified: counts };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  seedDemo()
    .then((result) => {
      console.log(
        `Demo verified: ${result.verified.tasks} tasks, ${result.verified.agents} registry entries, ${result.verified.sprints} sprint groupings, ${result.verified.chat} messages and ${result.verified.telemetry} telemetry events (${result.created} new records).`
      );
    })
    .catch((error) => {
      console.error(`Demo seed incomplete: ${formatApiError(error)}`);
      process.exitCode = 1;
    });
}
