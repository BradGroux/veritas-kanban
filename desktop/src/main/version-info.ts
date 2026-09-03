import os from 'node:os';

import { DESKTOP_APP_ID, DESKTOP_APP_NAME } from './app-metadata.js';
import type { DesktopAppInfo } from './types.js';
import { resolveDesktopUpdateChannel } from './updates.js';

declare const __VERITAS_BUILD_SHA__: string | undefined;
declare const __VERITAS_RELEASE_CHANNEL__: string | undefined;

export interface DesktopAppInfoOverrides {
  platform?: NodeJS.Platform;
  arch?: string;
  osVersion?: string;
  requestedChannel?: string;
  buildIdentity?: string | null;
}

function embeddedBuildIdentity(): string | null {
  const value = typeof __VERITAS_BUILD_SHA__ === 'string' ? __VERITAS_BUILD_SHA__ : undefined;
  return normalizeBuildIdentity(value);
}

function embeddedReleaseChannel(): string | undefined {
  return typeof __VERITAS_RELEASE_CHANNEL__ === 'string' && __VERITAS_RELEASE_CHANNEL__.trim()
    ? __VERITAS_RELEASE_CHANNEL__
    : undefined;
}

export function normalizeBuildIdentity(value: string | undefined | null): string | null {
  const normalized = value?.trim();
  if (!normalized || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function resolveSystemVersion(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    const electronProcess = process as NodeJS.Process & { getSystemVersion?: () => string };
    const systemVersion = electronProcess.getSystemVersion?.();
    if (systemVersion?.trim()) return systemVersion.trim();
  }
  return os.release();
}

export function createDesktopAppInfo(
  version: string,
  packaged: boolean,
  overrides: DesktopAppInfoOverrides = {}
): DesktopAppInfo {
  const platform = overrides.platform ?? process.platform;
  const buildIdentity =
    overrides.buildIdentity === undefined
      ? embeddedBuildIdentity()
      : normalizeBuildIdentity(overrides.buildIdentity);
  return {
    name: DESKTOP_APP_NAME,
    appId: DESKTOP_APP_ID,
    version,
    buildIdentity,
    channel: resolveDesktopUpdateChannel(
      overrides.requestedChannel ?? embeddedReleaseChannel() ?? process.env.VERITAS_UPDATE_CHANNEL,
      version,
      packaged
    ),
    platform,
    arch: overrides.arch ?? process.arch,
    osVersion: overrides.osVersion ?? resolveSystemVersion(platform),
    packaged,
  };
}

function platformLabel(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  if (platform === 'linux') return 'Linux';
  return platform;
}

function aboutArchitectureLabel(info: DesktopAppInfo): string {
  if (info.platform === 'darwin' && info.arch === 'arm64') return 'Apple silicon';
  if (info.platform === 'darwin' && info.arch === 'x64') return 'Intel';
  return info.arch;
}

function titleCase(value: string): string {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

export function formatDesktopVersionInfo(info: DesktopAppInfo): string {
  const lines = [`${info.name} ${info.version}`];
  if (info.buildIdentity) {
    lines.push(`Build: ${info.buildIdentity}`);
  } else if (!info.packaged) {
    lines.push('Build: development');
  }
  lines.push(
    `Channel: ${info.channel}`,
    `${platformLabel(info.platform)} ${info.osVersion} · ${info.arch}`
  );
  return lines.join('\n');
}

export function createDesktopAboutPanelOptions(info: DesktopAppInfo) {
  const displayedBuild = info.buildIdentity?.slice(0, 12);
  const platformSummary = `${platformLabel(info.platform)} ${info.osVersion} · ${aboutArchitectureLabel(info)}`;
  return {
    applicationName: info.name,
    applicationVersion: info.version,
    version: displayedBuild ? `Build ${displayedBuild}` : `${titleCase(info.channel)} channel`,
    copyright: 'MIT License · © 2026 Digital Meld',
    credits: [
      'Local-first task management and agent orchestration',
      '',
      `${titleCase(info.channel)} channel · ${platformSummary}`,
      '',
      'github.com/BradGroux/veritas-kanban',
    ].join('\n'),
  };
}
