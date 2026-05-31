import path from 'node:path';

import type { DesktopPaths } from './types.js';

export interface CreateDesktopPathsOptions {
  userDataPath: string;
  repoRoot: string;
  isPackaged: boolean;
  profile?: string;
}

function profileSegment(profile: string | undefined): string {
  return (profile || 'default').replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function createDesktopPaths(options: CreateDesktopPathsOptions): DesktopPaths {
  const appHome = options.isPackaged
    ? options.userDataPath
    : path.join(options.repoRoot, '.veritas-desktop-dev', profileSegment(options.profile));

  return {
    appHome,
    configDir: path.join(appHome, 'config'),
    dataDir: path.join(appHome, 'data'),
    logsDir: path.join(appHome, 'logs'),
    runtimeDir: path.join(appHome, 'runtime'),
    exportsDir: path.join(appHome, 'exports'),
    backupsDir: path.join(appHome, 'backups'),
    debugBundlesDir: path.join(appHome, 'debug-bundles'),
  };
}

export function resolveRepoRoot(appPath: string, cwd = process.cwd()): string {
  if (process.env.VERITAS_REPO_ROOT) {
    return process.env.VERITAS_REPO_ROOT;
  }

  if (path.basename(cwd) === 'desktop') {
    return path.resolve(cwd, '..');
  }

  const segments = appPath.split(path.sep);
  const desktopIndex = segments.lastIndexOf('desktop');
  if (desktopIndex > 0) {
    return segments.slice(0, desktopIndex).join(path.sep) || path.sep;
  }

  return path.resolve(appPath, '..');
}
