import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { SqliteFilesystemPosture } from '@veritas-kanban/shared';

export interface SqliteFilesystemDecision {
  platform: string;
  filesystemType: string;
  posture: Exclude<SqliteFilesystemPosture, 'not-applicable'>;
  detectionSource: string;
  reasonCode: string;
}

interface MountedFilesystem {
  mountPoint: string;
  filesystemType: string;
  local?: boolean;
}

export interface WindowsVolume {
  accessPath: string;
  driveType: string;
  filesystemType: string;
}

export interface SqliteFilesystemDetectionDependencies {
  platform?: NodeJS.Platform;
  realpath?: (targetPath: string) => string;
  readTextFile?: (targetPath: string) => string;
  runCommand?: (command: string, args: string[]) => string;
}

const LINUX_SUPPORTED_LOCAL = new Set([
  'btrfs',
  'ext2',
  'ext3',
  'ext4',
  'f2fs',
  'jfs',
  'xfs',
  'zfs',
]);

const DARWIN_SUPPORTED_LOCAL = new Set(['apfs', 'hfs']);
const KNOWN_VOLATILE = new Set(['ramfs', 'tmpfs']);
const WINDOWS_SUPPORTED_LOCAL = new Set(['ntfs', 'refs']);

const WINDOWS_VOLUME_PROBE = String.raw`
$records = @()
Get-Partition -ErrorAction SilentlyContinue | ForEach-Object {
  $volume = $_ | Get-Volume -ErrorAction SilentlyContinue
  if ($null -ne $volume) {
    foreach ($accessPath in $_.AccessPaths) {
      $records += [pscustomobject]@{
        accessPath = $accessPath
        driveType = [string]$volume.DriveType
        filesystemType = [string]$volume.FileSystem
      }
    }
  }
}
Get-CimInstance Win32_LogicalDisk -ErrorAction SilentlyContinue | ForEach-Object {
  $driveType = switch ($_.DriveType) {
    2 { 'Removable' }
    3 { 'Fixed' }
    4 { 'Remote' }
    6 { 'RAMDisk' }
    default { 'Unknown' }
  }
  $records += [pscustomobject]@{
    accessPath = "$($_.DeviceID)\"
    driveType = $driveType
    filesystemType = [string]$_.FileSystem
  }
}
$records | ConvertTo-Json -Compress
`;

const KNOWN_UNSAFE = new Set([
  '9p',
  'afs',
  'afpfs',
  'ceph',
  'cifs',
  'coda',
  'davfs',
  'drvfs',
  'glusterfs',
  'gpfs',
  'lustre',
  'nfs',
  'nfs4',
  'osxfuse',
  'remote',
  'smb2',
  'smb3',
  'smbfs',
  'virtiofs',
  'webdav',
]);

function normalizeFilesystemType(filesystemType: string): string {
  return filesystemType.trim().toLowerCase() || 'unknown';
}

export function classifyFilesystemType(
  platform: string,
  filesystemType: string
): Pick<SqliteFilesystemDecision, 'posture' | 'reasonCode'> {
  const normalized = normalizeFilesystemType(filesystemType);

  if (
    normalized === 'fuse' ||
    normalized === 'fuseblk' ||
    normalized === 'fusefs' ||
    normalized === 'macfuse' ||
    normalized.startsWith('fuse.') ||
    normalized.startsWith('fuse-')
  ) {
    return { posture: 'known-unsafe', reasonCode: 'fuse-filesystem' };
  }

  if (KNOWN_VOLATILE.has(normalized)) {
    return { posture: 'known-unsafe', reasonCode: 'volatile-filesystem' };
  }

  if (KNOWN_UNSAFE.has(normalized)) {
    return { posture: 'known-unsafe', reasonCode: 'known-remote-filesystem' };
  }

  const supported =
    (platform === 'linux' && LINUX_SUPPORTED_LOCAL.has(normalized)) ||
    (platform === 'darwin' && DARWIN_SUPPORTED_LOCAL.has(normalized));

  if (supported) {
    return { posture: 'supported-local', reasonCode: 'supported-local-filesystem' };
  }

  return { posture: 'unknown', reasonCode: 'unrecognized-filesystem' };
}

export function decodeMountPath(value: string): string {
  const replacements: Record<string, string> = {
    '011': '\t',
    '012': '\n',
    '040': ' ',
    '134': '\\',
  };

  return value.replace(/\\(011|012|040|134)/g, (_match, code: string) => replacements[code]);
}

function normalizeMountPoint(mountPoint: string): string {
  const normalized = path.normalize(mountPoint);
  return normalized === path.parse(normalized).root
    ? normalized
    : normalized.replace(/[\\/]+$/, '');
}

function isWithinMount(targetPath: string, mountPoint: string): boolean {
  const target = path.normalize(targetPath);
  const mount = normalizeMountPoint(mountPoint);
  const root = path.parse(mount).root;

  if (mount === root) {
    return target.startsWith(root);
  }

  return target === mount || target.startsWith(`${mount}${path.sep}`);
}

function selectMountedFilesystem(
  entries: MountedFilesystem[],
  targetPath: string
): MountedFilesystem | undefined {
  return entries
    .filter((entry) => isWithinMount(targetPath, entry.mountPoint))
    .sort((a, b) => b.mountPoint.length - a.mountPoint.length)[0];
}

export function parseLinuxMountInfo(
  content: string,
  targetPath: string
): MountedFilesystem | undefined {
  const entries = content
    .split(/\r?\n/)
    .map((line): MountedFilesystem | undefined => {
      const fields = line.trim().split(' ');
      const separator = fields.indexOf('-');
      if (separator < 6 || fields.length <= separator + 1) return undefined;

      return {
        mountPoint: decodeMountPath(fields[4]),
        filesystemType: normalizeFilesystemType(fields[separator + 1]),
      };
    })
    .filter((entry): entry is MountedFilesystem => Boolean(entry));

  return selectMountedFilesystem(entries, targetPath);
}

export function parseDarwinMountOutput(
  content: string,
  targetPath: string
): MountedFilesystem | undefined {
  const entries = content
    .split(/\r?\n/)
    .map((line): MountedFilesystem | undefined => {
      const match = line.match(/^.+ on (.+) \(([^,\s)]+)(?:,(.*))?\)$/);
      if (!match) return undefined;
      return {
        mountPoint: decodeMountPath(match[1]),
        filesystemType: normalizeFilesystemType(match[2]),
        local: (match[3] ?? '')
          .split(',')
          .map((option) => option.trim().toLowerCase())
          .includes('local'),
      };
    })
    .filter((entry): entry is MountedFilesystem => Boolean(entry));

  return selectMountedFilesystem(entries, targetPath);
}

function normalizeWindowsAccessPath(accessPath: string): string {
  const normalized = path.win32.normalize(accessPath.trim());
  return normalized.endsWith('\\') ? normalized : `${normalized}\\`;
}

function normalizeWindowsTargetPath(targetPath: string): string {
  return path.win32.normalize(targetPath.replace(/^\\\\\?\\(?=[a-z]:\\)/i, ''));
}

function isWithinWindowsAccessPath(targetPath: string, accessPath: string): boolean {
  const target = normalizeWindowsTargetPath(targetPath).toLowerCase();
  const mount = normalizeWindowsAccessPath(accessPath).toLowerCase();
  const mountWithoutSlash = mount.slice(0, -1);
  return target === mountWithoutSlash || target.startsWith(mount);
}

export function parseWindowsVolumeProbe(
  output: string,
  targetPath: string
): WindowsVolume | undefined {
  const parsed = JSON.parse(output) as unknown;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const volumes = rows
    .map((row): WindowsVolume | undefined => {
      if (!row || typeof row !== 'object') return undefined;
      const record = row as Record<string, unknown>;
      if (typeof record.accessPath !== 'string' || record.accessPath.trim().length === 0) {
        return undefined;
      }
      return {
        accessPath: normalizeWindowsAccessPath(record.accessPath),
        driveType: String(record.driveType ?? 'unknown')
          .trim()
          .toLowerCase(),
        filesystemType: normalizeFilesystemType(String(record.filesystemType ?? 'unknown')),
      };
    })
    .filter((volume): volume is WindowsVolume => Boolean(volume));

  return volumes
    .filter((volume) => isWithinWindowsAccessPath(targetPath, volume.accessPath))
    .sort((a, b) => b.accessPath.length - a.accessPath.length)[0];
}

function classifyWindowsVolume(volume: WindowsVolume): SqliteFilesystemDecision {
  if (volume.driveType === 'remote') {
    return {
      platform: 'win32',
      filesystemType: volume.filesystemType,
      posture: 'known-unsafe',
      detectionSource: 'windows-volume-probe',
      reasonCode: 'known-remote-filesystem',
    };
  }

  if (volume.driveType === 'ramdisk' || volume.driveType === 'ram-disk') {
    return {
      platform: 'win32',
      filesystemType: volume.filesystemType,
      posture: 'known-unsafe',
      detectionSource: 'windows-volume-probe',
      reasonCode: 'volatile-filesystem',
    };
  }

  const supported =
    volume.driveType === 'fixed' && WINDOWS_SUPPORTED_LOCAL.has(volume.filesystemType);
  return {
    platform: 'win32',
    filesystemType: volume.filesystemType,
    posture: supported ? 'supported-local' : 'unknown',
    detectionSource: 'windows-volume-probe',
    reasonCode: supported ? 'supported-local-filesystem' : 'windows-volume-unvalidated',
  };
}

function decision(
  platform: string,
  filesystemType: string,
  detectionSource: string,
  reasonCode?: string
): SqliteFilesystemDecision {
  const normalizedType = normalizeFilesystemType(filesystemType);
  const classification = classifyFilesystemType(platform, normalizedType);
  return {
    platform,
    filesystemType: normalizedType,
    posture: classification.posture,
    detectionSource,
    reasonCode: reasonCode ?? classification.reasonCode,
  };
}

function unknownDecision(
  platform: string,
  detectionSource: string,
  reasonCode: string
): SqliteFilesystemDecision {
  return {
    platform,
    filesystemType: 'unknown',
    posture: 'unknown',
    detectionSource,
    reasonCode,
  };
}

export function detectSqliteFilesystem(
  directoryPath: string,
  dependencies?: SqliteFilesystemDetectionDependencies
): SqliteFilesystemDecision {
  const platform = dependencies?.platform ?? process.platform;
  const realpath =
    dependencies?.realpath ?? ((targetPath: string) => realpathSync.native(targetPath));
  const readTextFile =
    dependencies?.readTextFile ?? ((targetPath: string) => readFileSync(targetPath, 'utf8'));
  const runCommand =
    dependencies?.runCommand ??
    ((command: string, args: string[]) => execFileSync(command, args, { encoding: 'utf8' }));

  let canonicalPath: string;
  try {
    canonicalPath = realpath(directoryPath);
  } catch {
    return unknownDecision(platform, 'realpath', 'filesystem-realpath-failed');
  }

  let result: SqliteFilesystemDecision;
  try {
    if (platform === 'linux') {
      const mounted = parseLinuxMountInfo(readTextFile('/proc/self/mountinfo'), canonicalPath);
      result = mounted
        ? decision(platform, mounted.filesystemType, 'linux-mountinfo')
        : unknownDecision(platform, 'linux-mountinfo', 'mount-not-found');
    } else if (platform === 'darwin') {
      const mounted = parseDarwinMountOutput(runCommand('/sbin/mount', []), canonicalPath);
      if (!mounted) {
        result = unknownDecision(platform, 'darwin-mount-table', 'mount-not-found');
      } else if (DARWIN_SUPPORTED_LOCAL.has(mounted.filesystemType) && mounted.local !== true) {
        result = {
          platform,
          filesystemType: mounted.filesystemType,
          posture: 'unknown',
          detectionSource: 'darwin-mount-table',
          reasonCode: 'darwin-local-signal-missing',
        };
      } else {
        result = decision(platform, mounted.filesystemType, 'darwin-mount-table');
      }
    } else if (platform === 'win32') {
      if (/^\\\\\?\\UNC\\/i.test(canonicalPath) || /^\\\\(?!\?\\)/.test(canonicalPath)) {
        result = decision(platform, 'remote', 'windows-path', 'windows-network-path');
      } else {
        const volume = parseWindowsVolumeProbe(
          runCommand('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            WINDOWS_VOLUME_PROBE,
          ]),
          canonicalPath
        );
        result = volume
          ? classifyWindowsVolume(volume)
          : unknownDecision(platform, 'windows-volume-probe', 'windows-volume-unresolved');
      }
    } else {
      result = unknownDecision(platform, 'platform', 'unsupported-platform');
    }
  } catch {
    result = unknownDecision(platform, `${platform}-filesystem-probe`, 'filesystem-probe-failed');
  }

  return result;
}
