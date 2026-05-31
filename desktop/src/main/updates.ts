import type { AppUpdater } from 'electron-updater';

import {
  redactSensitiveString,
  type DesktopUpdateStatus,
} from '../shared/desktop-bridge-contracts.js';

type DesktopUpdateEvent =
  | 'checking-for-update'
  | 'update-not-available'
  | 'update-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'error';

export interface DesktopUpdateAdapterConfigureOptions {
  allowPrerelease: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  channel: DesktopUpdateStatus['channel'];
  forceDevUpdateConfig: boolean;
}

export interface DesktopUpdateAdapter {
  configure(options: DesktopUpdateAdapterConfigureOptions): void;
  on(event: DesktopUpdateEvent, listener: (...args: unknown[]) => void): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  isUpdaterActive(): boolean;
}

export interface DesktopUpdateServiceOptions {
  adapter: DesktopUpdateAdapter;
  channel: DesktopUpdateStatus['channel'];
  currentVersion: string;
  emitStatus?: (status: DesktopUpdateStatus) => void;
  forceDevUpdateConfig?: boolean;
  packaged: boolean;
  now?: () => Date;
}

export class ElectronAutoUpdaterAdapter implements DesktopUpdateAdapter {
  constructor(private readonly updater: AppUpdater) {}

  configure(options: DesktopUpdateAdapterConfigureOptions): void {
    this.updater.autoDownload = options.autoDownload;
    this.updater.autoInstallOnAppQuit = options.autoInstallOnAppQuit;
    this.updater.allowPrerelease = options.allowPrerelease;
    this.updater.channel = options.channel === 'stable' ? null : options.channel;
    this.updater.forceDevUpdateConfig = options.forceDevUpdateConfig;
  }

  on(event: DesktopUpdateEvent, listener: (...args: unknown[]) => void): void {
    this.updater.on(event, listener as never);
  }

  checkForUpdates(): Promise<unknown> {
    return this.updater.checkForUpdates();
  }

  downloadUpdate(): Promise<unknown> {
    return this.updater.downloadUpdate();
  }

  quitAndInstall(): void {
    this.updater.quitAndInstall();
  }

  isUpdaterActive(): boolean {
    return this.updater.isUpdaterActive();
  }
}

export class DesktopUpdateService {
  private readonly enabled: boolean;
  private status: DesktopUpdateStatus;

  constructor(private readonly options: DesktopUpdateServiceOptions) {
    this.enabled = options.packaged || options.forceDevUpdateConfig === true;
    this.status = this.enabled
      ? this.createStatus('idle', 'Update checks are ready.')
      : this.createStatus('unsupported', 'Updater checks run only from packaged builds.');

    options.adapter.configure({
      allowPrerelease: options.channel !== 'stable',
      autoDownload: false,
      autoInstallOnAppQuit: false,
      channel: options.channel,
      forceDevUpdateConfig: options.forceDevUpdateConfig === true,
    });
    this.bindEvents();
  }

  snapshot(): DesktopUpdateStatus {
    return this.status;
  }

  async checkForUpdates(): Promise<DesktopUpdateStatus> {
    if (!this.canRunUpdater()) {
      return this.status;
    }

    this.setStatus('checking', 'Checking for updates.');
    try {
      await this.options.adapter.checkForUpdates();
      if (this.status.state === 'checking') {
        this.setStatus('idle', 'No update metadata was returned.');
      }
    } catch (error) {
      this.setStatus('failed', redactUpdateError(error));
    }
    return this.status;
  }

  async downloadUpdate(): Promise<DesktopUpdateStatus> {
    if (!this.canRunUpdater()) {
      return this.status;
    }

    this.setStatus('downloading', 'Downloading update.');
    try {
      await this.options.adapter.downloadUpdate();
      if (this.status.state === 'downloading') {
        this.setStatus('ready', 'Update downloaded and ready to install.');
      }
    } catch (error) {
      this.setStatus('failed', redactUpdateError(error));
    }
    return this.status;
  }

  installUpdate(): DesktopUpdateStatus {
    if (!this.canRunUpdater()) {
      return this.status;
    }

    if (this.status.state !== 'ready') {
      this.setStatus('failed', 'No downloaded update is ready to install.');
      return this.status;
    }

    this.options.adapter.quitAndInstall();
    this.setStatus('ready', 'Installing update.');
    return this.status;
  }

  private bindEvents(): void {
    this.options.adapter.on('checking-for-update', () => {
      this.setStatus('checking', 'Checking for updates.');
    });
    this.options.adapter.on('update-not-available', () => {
      this.setStatus('idle', 'Already running the latest version.');
    });
    this.options.adapter.on('update-available', (info) => {
      this.setStatus(
        'available',
        `Update ${readUpdateVersion(info) ?? 'available'} is available.`,
        readUpdateVersion(info)
      );
    });
    this.options.adapter.on('download-progress', (info) => {
      const percent = readDownloadPercent(info);
      this.setStatus(
        'downloading',
        percent === null ? 'Downloading update.' : `${percent}% downloaded.`
      );
    });
    this.options.adapter.on('update-downloaded', (info) => {
      this.setStatus(
        'ready',
        `Update ${readUpdateVersion(info) ?? 'downloaded'} is ready to install.`,
        readUpdateVersion(info)
      );
    });
    this.options.adapter.on('error', (error) => {
      this.setStatus('failed', redactUpdateError(error));
    });
  }

  private canRunUpdater(): boolean {
    if (!this.enabled) {
      this.setStatus('unsupported', 'Updater checks run only from packaged builds.');
      return false;
    }

    if (!this.options.adapter.isUpdaterActive()) {
      this.setStatus('unsupported', 'Updater provider is not active for this build.');
      return false;
    }

    return true;
  }

  private setStatus(
    state: DesktopUpdateStatus['state'],
    detail: string,
    availableVersion?: string
  ): void {
    this.status = this.createStatus(state, detail, availableVersion);
    this.options.emitStatus?.(this.status);
  }

  private createStatus(
    state: DesktopUpdateStatus['state'],
    detail: string,
    availableVersion?: string
  ): DesktopUpdateStatus {
    return {
      state,
      currentVersion: this.options.currentVersion,
      availableVersion,
      channel: this.options.channel,
      checkedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      detail,
    };
  }
}

export function resolveDesktopUpdateChannel(
  requested: string | undefined,
  currentVersion: string,
  packaged: boolean
): DesktopUpdateStatus['channel'] {
  const normalized = requested?.trim().toLowerCase();
  if (normalized === 'stable' || normalized === 'beta' || normalized === 'dev') {
    return normalized;
  }
  if (/\b(alpha|beta|rc|next|canary|dev)\b/i.test(currentVersion)) {
    return 'beta';
  }
  return packaged ? 'stable' : 'dev';
}

function readUpdateVersion(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const version = value.version;
  return typeof version === 'string' && version.trim() ? version.trim() : undefined;
}

function readDownloadPercent(value: unknown): number | null {
  if (!isRecord(value) || typeof value.percent !== 'number' || !Number.isFinite(value.percent)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value.percent)));
}

function redactUpdateError(error: unknown): string {
  return redactSensitiveString(error instanceof Error ? error.message : String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
