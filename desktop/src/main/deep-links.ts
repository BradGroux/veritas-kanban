import {
  DESKTOP_COMMAND_NAMES,
  type DesktopCommandDispatchRequest,
  type DesktopCommandName,
} from '../shared/desktop-bridge-contracts.js';

const RESOURCE_COMMANDS: Record<string, DesktopCommandName> = {
  task: 'open-command-center',
  workflow: 'open-command-center',
  invite: 'open-settings',
  pairing: 'open-settings',
  run: 'open-command-center',
  settings: 'open-settings',
  'command-center': 'open-command-center',
  search: 'open-search',
  'work-product': 'export-work-product',
};

export interface DesktopDeepLinkResult {
  url: string;
  resource: string;
  resourceId: string | null;
  command: DesktopCommandDispatchRequest;
}

export function parseDesktopDeepLink(rawUrl: string): DesktopDeepLinkResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Deep link URL is invalid');
  }

  if (url.protocol !== 'veritas:') {
    throw new Error(`Deep link protocol is not supported: ${url.protocol}`);
  }

  const resource = url.hostname || url.pathname.split('/').filter(Boolean)[0] || 'command-center';
  const segments = url.pathname.split('/').filter(Boolean);
  const encodedResourceId = segments[url.hostname ? 0 : 1] ?? null;
  if (resource === 'task' && segments.length !== (url.hostname ? 1 : 2))
    throw new Error('Task deep link destination is not supported');
  const resourceId = encodedResourceId ? decodeURIComponent(encodedResourceId) : null;
  const command = RESOURCE_COMMANDS[resource];

  if (!command || !DESKTOP_COMMAND_NAMES.includes(command)) {
    throw new Error(`Deep link resource is not supported: ${resource}`);
  }

  return {
    url: url.toString(),
    resource,
    resourceId,
    command: {
      command,
      source: 'deep-link',
      payload: {
        deepLink: {
          url: url.toString(),
          resource,
          resourceId,
          params: Object.fromEntries(url.searchParams.entries()),
        },
      },
    },
  };
}

export function extractDeepLinkFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith('veritas://')) ?? null;
}
