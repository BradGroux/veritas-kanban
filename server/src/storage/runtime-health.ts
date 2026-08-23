import fs from 'fs/promises';
import { getRuntimeDir } from '../utils/paths.js';

const MIN_FREE_BYTES = 100 * 1024 * 1024;

export async function checkRuntimeStorageAccess(): Promise<boolean> {
  try {
    await fs.access(getRuntimeDir(), fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function checkRuntimeDiskSpace(): Promise<boolean> {
  try {
    const stats = await fs.statfs(getRuntimeDir());
    return stats.bfree * stats.bsize >= MIN_FREE_BYTES;
  } catch {
    return false;
  }
}
