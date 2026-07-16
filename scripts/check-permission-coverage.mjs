#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const allowedClassifications = new Set([
  'public/setup',
  'authenticated-read',
  'authenticated-write',
  'agent-scoped',
  'workspace-admin',
  'owner-admin',
  'desktop-only',
  'internal-only',
]);
const justificationRequired = new Set(['public/setup', 'desktop-only', 'internal-only']);
const permissionRequired = new Set([
  'authenticated-read',
  'authenticated-write',
  'agent-scoped',
  'workspace-admin',
  'owner-admin',
]);

async function readText(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

function matches(source, regex) {
  return [...source.matchAll(regex)].map((match) => match[1]);
}

async function discoverUnionType(relativePath, typeName) {
  const source = await readText(relativePath);
  const declaration = source.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
  if (!declaration) {
    throw new Error(`Could not find ${typeName} declaration in ${relativePath}`);
  }

  return matches(declaration[1], /'([^']+)'/g);
}

function firstCommandToken(commandLiteral) {
  return commandLiteral.split(/[ <[]/, 1)[0];
}

async function discoverCliCommands() {
  const commandFiles = [
    'agent-status',
    'agents',
    'automation',
    'backlog',
    'comments',
    'github',
    'notifications',
    'projects',
    'setup',
    'sqlite',
    'sprints',
    'summary',
    'tasks',
    'time',
    'usage',
    'workflow',
  ];
  const ids = [];

  for (const file of commandFiles) {
    const source = await readText(`cli/src/commands/${file}.ts`);
    for (const command of matches(source, /\.command\('([^']+)'/g)) {
      ids.push(`cli:${file}:${firstCommandToken(command)}`);
    }
  }

  return ids;
}

async function discoverMcpTools() {
  const toolFiles = [
    'agents',
    'automation',
    'comments',
    'notifications',
    'projects',
    'sprints',
    'summary',
    'tasks',
  ];
  const ids = [];

  for (const file of toolFiles) {
    const source = await readText(`mcp/src/tools/${file}.ts`);
    for (const toolName of matches(source, /name:\s*'([^']+)'/g)) {
      ids.push(`mcp:${toolName}`);
    }
  }

  return ids;
}

async function discoverWebSocketSurfaces() {
  const sources = [
    await readText('server/src/services/broadcast-service.ts'),
    await readText('server/src/routes/agent-status.ts'),
    await readText('server/src/server.ts'),
  ].join('\n');

  const outbound = matches(sources, /type:\s*'([^']+)'/g)
    .filter((type) => type.includes(':') || type === 'error' || type === 'subscribed')
    .map((type) => `websocket:${type}`);
  const inbound = matches(sources, /message\.type\s*===\s*'([^']+)'/g).map(
    (type) => `websocket-inbound:${type}`
  );

  return [...new Set([...outbound, ...inbound])];
}

async function discoverWorkflowStepTypes() {
  const sharedTypes = await discoverUnionType('shared/src/types/workflow.ts', 'StepType');
  const serverTypes = await discoverUnionType('server/src/types/workflow.ts', 'StepType');

  return [...new Set([...sharedTypes, ...serverTypes])].map((type) => `workflow-step:${type}`);
}

async function discoverTransitionHookTypes() {
  const source = 'shared/src/types/transition-hooks.types.ts';
  const gates = await discoverUnionType(source, 'GateType');
  const actions = await discoverUnionType(source, 'ActionType');

  return [
    ...gates.map((type) => `transition-gate:${type}`),
    ...actions.map((type) => `transition-action:${type}`),
  ];
}

async function discoverCommandPaletteActions() {
  const paletteSource = await readText('web/src/components/layout/CommandPalette.tsx');
  const viewSource = await readText('web/src/lib/views.ts');
  const staticCommandIds = matches(paletteSource, /id:\s*'([^']+)'/g);
  const navigationIds = matches(viewSource, /view:\s*'([^']+)'/g).map((view) => `go-${view}`);

  return [...new Set([...staticCommandIds, ...navigationIds])].map((id) => `command-palette:${id}`);
}

async function discoverBackgroundJobs() {
  const jobs = [
    {
      id: 'background-job:agent-registry-stale-check',
      source: 'server/src/services/agent-registry-service.ts',
      marker: 'setInterval(() => this.checkStaleAgents(), STALE_CHECK_INTERVAL_MS)',
    },
    {
      id: 'background-job:github-sync-poll',
      source: 'server/src/services/github-sync-service.ts',
      marker: 'this.pollTimer = setInterval(async () =>',
    },
    {
      id: 'background-job:prometheus-event-loop-lag',
      source: 'server/src/services/metrics/prometheus.ts',
      marker: 'this.lagTimer = setInterval(() =>',
    },
    {
      id: 'background-job:task-github-reconcile',
      source: 'server/src/services/task-service.ts',
      marker: 'this.taskSyncReconcileInterval = setInterval(() =>',
    },
    {
      id: 'background-job:websocket-heartbeat',
      source: 'server/src/server.ts',
      marker: 'const heartbeatInterval = setInterval(() =>',
    },
  ];

  for (const job of jobs) {
    const source = await readText(job.source);
    if (!source.includes(job.marker)) {
      throw new Error(`Could not find background job marker for ${job.id}`);
    }
  }

  return jobs.map((job) => job.id);
}

async function assertRestRouteMapCoverage(errors) {
  const v1Source = await readText('server/src/routes/v1/index.ts');
  const permissionSource = await readText('shared/src/utils/api-permissions.ts');
  const serverPrefixes = new Set(
    matches(v1Source, /v1Router\.use\(\s*['"]([^'"]+)['"]/g).map((prefix) => `/api${prefix}`)
  );
  const mappedPrefixes = new Set(matches(permissionSource, /prefix:\s*'([^']+)'/g));

  for (const prefix of serverPrefixes) {
    if (!mappedPrefixes.has(prefix)) {
      errors.push(`REST route prefix missing from client permission map: ${prefix}`);
    }
  }
}

function assertManifestShape(manifest, errors) {
  if (manifest.version !== 1) {
    errors.push('Manifest version must be 1');
  }
  if (!Array.isArray(manifest.surfaces)) {
    errors.push('Manifest must contain a surfaces array');
    return new Set();
  }

  const ids = new Set();
  for (const surface of manifest.surfaces) {
    if (!surface.id || typeof surface.id !== 'string') {
      errors.push(`Manifest surface missing string id: ${JSON.stringify(surface)}`);
      continue;
    }
    if (ids.has(surface.id)) {
      errors.push(`Duplicate manifest surface id: ${surface.id}`);
    }
    ids.add(surface.id);

    if (!allowedClassifications.has(surface.classification)) {
      errors.push(`Invalid classification for ${surface.id}: ${surface.classification}`);
    }
    if (!surface.kind || typeof surface.kind !== 'string') {
      errors.push(`Surface ${surface.id} is missing kind`);
    }
    if (!surface.source || typeof surface.source !== 'string') {
      errors.push(`Surface ${surface.id} is missing source`);
    }
    if (permissionRequired.has(surface.classification) && !surface.permissions?.length) {
      errors.push(`Surface ${surface.id} requires at least one permission`);
    }
    if (justificationRequired.has(surface.classification) && !surface.justification) {
      errors.push(`Surface ${surface.id} requires a justification`);
    }
    if (!surface.denialReason && !justificationRequired.has(surface.classification)) {
      errors.push(`Surface ${surface.id} is missing denialReason`);
    }
  }

  return ids;
}

async function main() {
  const errors = [];
  const manifest = await readJson('docs/security/permission-coverage.json');
  const manifestIds = assertManifestShape(manifest, errors);

  await assertRestRouteMapCoverage(errors);

  const discoveredIds = [
    'rest:v1-route-map',
    ...(await discoverWebSocketSurfaces()),
    ...(await discoverCliCommands()),
    ...(await discoverMcpTools()),
    ...(await discoverWorkflowStepTypes()),
    ...(await discoverTransitionHookTypes()),
    ...(await discoverCommandPaletteActions()),
    ...(await discoverBackgroundJobs()),
  ];

  for (const id of discoveredIds) {
    if (!manifestIds.has(id)) {
      errors.push(`Missing permission manifest entry: ${id}`);
    }
  }

  if (errors.length > 0) {
    console.error('Permission coverage check failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Permission coverage manifest covers ${manifestIds.size} classified surfaces.`);
  console.log(`Checked ${discoveredIds.length} discovered surfaces plus REST route-map parity.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
