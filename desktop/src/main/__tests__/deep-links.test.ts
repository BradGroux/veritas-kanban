import { describe, expect, it } from 'vitest';

import { extractDeepLinkFromArgv, parseDesktopDeepLink } from '../deep-links.js';

describe('desktop deep links', () => {
  it('maps task links into command-center navigation payloads', () => {
    expect(parseDesktopDeepLink('veritas://task/task-123?tab=work')).toEqual({
      url: 'veritas://task/task-123?tab=work',
      resource: 'task',
      resourceId: 'task-123',
      command: {
        command: 'open-command-center',
        source: 'deep-link',
        payload: {
          deepLink: {
            url: 'veritas://task/task-123?tab=work',
            resource: 'task',
            resourceId: 'task-123',
            params: {
              tab: 'work',
            },
          },
        },
      },
    });
  });

  it('supports settings, pairing, run, workflow, and command-center destinations', () => {
    expect(parseDesktopDeepLink('veritas://settings').command.command).toBe('open-settings');
    expect(parseDesktopDeepLink('veritas://pairing/device-1').command.command).toBe(
      'open-settings'
    );
    expect(parseDesktopDeepLink('veritas://run/run-1').command.command).toBe('open-command-center');
    expect(parseDesktopDeepLink('veritas://workflow/workflow-1').command.command).toBe(
      'open-command-center'
    );
    expect(parseDesktopDeepLink('veritas://command-center').command.command).toBe(
      'open-command-center'
    );
  });

  it('rejects unsupported protocols and resources', () => {
    expect(() => parseDesktopDeepLink('https://example.com/task/1')).toThrow('protocol');
    expect(() => parseDesktopDeepLink('veritas://shell/rm')).toThrow('not supported');
  });

  it('extracts veritas links from process argv', () => {
    expect(extractDeepLinkFromArgv(['Electron', '.', 'veritas://task/task-1'])).toBe(
      'veritas://task/task-1'
    );
    expect(extractDeepLinkFromArgv(['Electron', '.'])).toBeNull();
  });
});
