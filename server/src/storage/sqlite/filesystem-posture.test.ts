import { describe, expect, it, vi } from 'vitest';
import {
  classifyFilesystemType,
  decodeMountPath,
  detectSqliteFilesystem,
  parseDarwinMountOutput,
  parseLinuxMountInfo,
  parseWindowsVolumeProbe,
} from './filesystem-posture.js';

describe('SQLite filesystem posture', () => {
  it('classifies supported local and known unsafe filesystem types', () => {
    expect(classifyFilesystemType('linux', 'ext4').posture).toBe('supported-local');
    expect(classifyFilesystemType('darwin', 'apfs').posture).toBe('supported-local');
    expect(classifyFilesystemType('linux', 'nfs4').posture).toBe('known-unsafe');
    expect(classifyFilesystemType('linux', 'cifs').posture).toBe('known-unsafe');
    expect(classifyFilesystemType('linux', 'fuse.sshfs').posture).toBe('known-unsafe');
    expect(classifyFilesystemType('linux', 'fuseblk').posture).toBe('known-unsafe');
    expect(classifyFilesystemType('linux', 'fuse-overlayfs').posture).toBe('known-unsafe');
    expect(classifyFilesystemType('darwin', 'macfuse').posture).toBe('known-unsafe');
    expect(classifyFilesystemType('linux', '9p').posture).toBe('known-unsafe');
    expect(classifyFilesystemType('linux', 'tmpfs')).toEqual({
      posture: 'known-unsafe',
      reasonCode: 'volatile-filesystem',
    });
    expect(classifyFilesystemType('linux', 'ramfs').posture).toBe('known-unsafe');
    expect(classifyFilesystemType('linux', 'overlay').posture).toBe('unknown');
    expect(classifyFilesystemType('darwin', 'mysteryfs').posture).toBe('unknown');
  });

  it('selects the longest matching Linux mount and decodes escaped paths', () => {
    const mountInfo = [
      '36 25 0:32 / / rw,relatime - overlay overlay rw',
      '41 36 0:40 / /mnt/team\\040share rw,relatime - nfs4 server:/share rw',
    ].join('\n');

    expect(decodeMountPath('/mnt/team\\040share')).toBe('/mnt/team share');
    expect(parseLinuxMountInfo(mountInfo, '/mnt/team share/project')).toEqual({
      mountPoint: '/mnt/team share',
      filesystemType: 'nfs4',
    });
    expect(parseLinuxMountInfo(mountInfo, '/workspace/project')).toEqual({
      mountPoint: '/',
      filesystemType: 'overlay',
    });
  });

  it('classifies Linux mount table evidence and fails unknown on probe errors', () => {
    const supported = detectSqliteFilesystem('/data', {
      platform: 'linux',
      realpath: (value) => value,
      readTextFile: () => '36 25 0:32 / / rw,relatime - ext4 /dev/sda1 rw',
    });
    expect(supported).toMatchObject({
      posture: 'supported-local',
      filesystemType: 'ext4',
      detectionSource: 'linux-mountinfo',
    });

    const failed = detectSqliteFilesystem('/data', {
      platform: 'linux',
      realpath: (value) => value,
      readTextFile: () => {
        throw new Error('unavailable');
      },
    });
    expect(failed).toMatchObject({
      posture: 'unknown',
      reasonCode: 'filesystem-probe-failed',
    });
  });

  it('selects the longest matching macOS mount and detects remote filesystems', () => {
    const mounts = [
      '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
      'server:/share on /Volumes/Team (nfs, nodev, nosuid)',
      '//server/share on /Volumes/SMB (smbfs, nodev, nosuid)',
      'macfuse on /Volumes/Fuse (fusefs, nodev)',
    ].join('\n');

    expect(parseDarwinMountOutput(mounts, '/Volumes/Team/project')).toMatchObject({
      mountPoint: '/Volumes/Team',
      filesystemType: 'nfs',
      local: false,
    });
    expect(parseDarwinMountOutput(mounts, '/Users/test')).toMatchObject({
      mountPoint: '/',
      filesystemType: 'apfs',
      local: true,
    });

    for (const targetPath of ['/Volumes/Team/project', '/Volumes/SMB/db', '/Volumes/Fuse/db']) {
      expect(
        detectSqliteFilesystem(targetPath, {
          platform: 'darwin',
          realpath: (value) => value,
          runCommand: () => mounts,
        }).posture
      ).toBe('known-unsafe');
    }
  });

  it('accepts only fixed NTFS/ReFS Windows volumes and selects folder mount points', () => {
    const volumes = JSON.stringify([
      { accessPath: 'C:\\', driveType: 'Fixed', filesystemType: 'NTFS' },
      { accessPath: 'C:\\data\\mounted\\', driveType: 'Fixed', filesystemType: 'ReFS' },
      { accessPath: 'R:\\', driveType: 'Remote', filesystemType: 'NTFS' },
      { accessPath: 'M:\\', driveType: 'Removable', filesystemType: 'exFAT' },
      { accessPath: 'T:\\', driveType: 'RAMDisk', filesystemType: 'NTFS' },
    ]);

    expect(parseWindowsVolumeProbe(volumes, 'C:\\data\\mounted\\project')).toMatchObject({
      accessPath: 'C:\\data\\mounted\\',
      filesystemType: 'refs',
    });

    const fixed = detectSqliteFilesystem('C:\\data', {
      platform: 'win32',
      realpath: (value) => value,
      runCommand: () => volumes,
    });
    expect(fixed).toMatchObject({
      posture: 'supported-local',
      filesystemType: 'ntfs',
      detectionSource: 'windows-volume-probe',
      reasonCode: 'supported-local-filesystem',
    });

    expect(
      detectSqliteFilesystem('C:\\data\\mounted\\project', {
        platform: 'win32',
        realpath: (value) => value,
        runCommand: () => volumes,
      })
    ).toMatchObject({ posture: 'supported-local', filesystemType: 'refs' });

    expect(
      detectSqliteFilesystem('M:\\data', {
        platform: 'win32',
        realpath: (value) => value,
        runCommand: () => volumes,
      }).posture
    ).toBe('unknown');
    expect(
      detectSqliteFilesystem('T:\\data', {
        platform: 'win32',
        realpath: (value) => value,
        runCommand: () => volumes,
      })
    ).toMatchObject({ posture: 'known-unsafe', reasonCode: 'volatile-filesystem' });
  });

  it('rejects Windows network paths and fails closed when volume evidence is unavailable', () => {
    const runCommand = vi.fn(() => {
      throw new Error('Network paths should not invoke the volume probe');
    });

    const remote = detectSqliteFilesystem('\\\\server\\share\\data', {
      platform: 'win32',
      realpath: (value) => value,
      runCommand,
    });
    expect(remote).toMatchObject({
      posture: 'known-unsafe',
      reasonCode: 'windows-network-path',
    });

    const extendedRemote = detectSqliteFilesystem('\\\\?\\UNC\\server\\share\\data', {
      platform: 'win32',
      realpath: (value) => value,
      runCommand,
    });
    expect(extendedRemote.posture).toBe('known-unsafe');
    expect(runCommand).not.toHaveBeenCalled();

    const extendedLocal = detectSqliteFilesystem('\\\\?\\C:\\data', {
      platform: 'win32',
      realpath: (value) => value,
      runCommand: () =>
        JSON.stringify({ accessPath: 'C:\\', driveType: 'Fixed', filesystemType: 'NTFS' }),
    });
    expect(extendedLocal).toMatchObject({
      posture: 'supported-local',
      filesystemType: 'ntfs',
    });

    expect(
      detectSqliteFilesystem('C:\\data', {
        platform: 'win32',
        realpath: (value) => value,
        runCommand: () => 'not-json',
      })
    ).toMatchObject({
      posture: 'unknown',
      reasonCode: 'filesystem-probe-failed',
    });
  });

  it('requires the macOS local mount signal for APFS and HFS', () => {
    const withoutLocal = '/dev/disk3s1 on /Volumes/Data (apfs, journaled)';
    const withLocal = '/dev/disk3s1 on /Volumes/Data (apfs, local, journaled)';

    expect(
      detectSqliteFilesystem('/Volumes/Data/project', {
        platform: 'darwin',
        realpath: (value) => value,
        runCommand: () => withoutLocal,
      })
    ).toMatchObject({ posture: 'unknown', reasonCode: 'darwin-local-signal-missing' });
    expect(
      detectSqliteFilesystem('/Volumes/Data/project', {
        platform: 'darwin',
        realpath: (value) => value,
        runCommand: () => withLocal,
      }).posture
    ).toBe('supported-local');
  });

  it('returns explicit unknown posture for unsupported platforms and realpath failures', () => {
    expect(
      detectSqliteFilesystem('/data', {
        platform: 'aix',
        realpath: (value) => value,
      })
    ).toMatchObject({ posture: 'unknown', reasonCode: 'unsupported-platform' });

    expect(
      detectSqliteFilesystem('/data', {
        platform: 'linux',
        realpath: () => {
          throw new Error('no path');
        },
      })
    ).toMatchObject({ posture: 'unknown', reasonCode: 'filesystem-realpath-failed' });
  });
});
