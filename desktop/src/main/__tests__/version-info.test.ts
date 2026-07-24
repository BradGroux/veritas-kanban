import { describe, expect, it } from 'vitest';

import {
  createDesktopAboutPanelOptions,
  createDesktopAppInfo,
  formatDesktopVersionInfo,
  normalizeBuildIdentity,
} from '../version-info.js';

describe('desktop version information', () => {
  it('formats authoritative packaged version, build, channel, and platform details', () => {
    const info = createDesktopAppInfo('6.0.2', true, {
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '15.5',
      buildIdentity: 'abc1234',
    });

    expect(info).toMatchObject({
      version: '6.0.2',
      buildIdentity: 'abc1234',
      channel: 'stable',
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '15.5',
      packaged: true,
    });
    expect(formatDesktopVersionInfo(info)).toBe(
      ['Veritas Kanban 6.0.2', 'Build: abc1234', 'Channel: stable', 'macOS 15.5 · arm64'].join('\n')
    );
  });

  it('labels prerelease and development builds without network access', () => {
    expect(
      createDesktopAppInfo('6.0.2-beta.1', true, {
        platform: 'darwin',
        arch: 'arm64',
        osVersion: '15.5',
        buildIdentity: null,
      }).channel
    ).toBe('beta');

    const development = createDesktopAppInfo('6.0.2', false, {
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '15.5',
      buildIdentity: null,
    });
    expect(development.channel).toBe('dev');
    expect(formatDesktopVersionInfo(development)).toContain('Build: development');
  });

  it('rejects path-like or unbounded build metadata from support output', () => {
    expect(normalizeBuildIdentity('/Users/example/private/build')).toBeNull();
    expect(normalizeBuildIdentity('a'.repeat(65))).toBeNull();

    const info = createDesktopAppInfo('6.0.2', true, {
      buildIdentity: '/Users/example/private/build',
      osVersion: '15.5',
    });
    expect(info.buildIdentity).toBeNull();
    expect(formatDesktopVersionInfo(info)).not.toContain('/Users/');
  });

  it('builds an offline native About panel from the same app information', () => {
    const info = createDesktopAppInfo('6.0.2', true, {
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '15.5',
      buildIdentity: 'abc1234',
    });

    expect(createDesktopAboutPanelOptions(info)).toMatchObject({
      applicationName: 'Veritas Kanban',
      applicationVersion: '6.0.2',
      version: 'Build abc1234',
      credits: expect.stringContaining('Channel: stable'),
    });
  });
});
