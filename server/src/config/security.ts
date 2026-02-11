import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from '../storage/fs-helpers.js';
import path from 'path';
import crypto from 'crypto';
import { createLogger } from '../lib/logger.js';
import { getRuntimeDir } from '../utils/paths.js';
const log = createLogger('security');

// Security config file location
const RUNTIME_DIR = getRuntimeDir();
const SECURITY_CONFIG_PATH = path.join(RUNTIME_DIR, 'security.json');
// Legacy path: security.ts originally only checked VERITAS_DATA_DIR (not DATA_DIR),
// so we preserve that for migration detection. Other services checked DATA_DIR instead.
const LEGACY_DATA_DIR = process.env.VERITAS_DATA_DIR || path.join(process.cwd(), '.veritas-kanban');
const LEGACY_SECURITY_CONFIG_PATH = path.join(LEGACY_DATA_DIR, 'security.json');
let migrationChecked = false;

function migrateSecurityConfig(): void {
  if (migrationChecked) return;
  migrationChecked = true;

  if (LEGACY_SECURITY_CONFIG_PATH === SECURITY_CONFIG_PATH) return;

  if (existsSync(LEGACY_SECURITY_CONFIG_PATH) && !existsSync(SECURITY_CONFIG_PATH)) {
    try {
      if (!existsSync(RUNTIME_DIR)) {
        mkdirSync(RUNTIME_DIR, { recursive: true });
      }

      const data = readFileSync(LEGACY_SECURITY_CONFIG_PATH, 'utf-8');
      writeFileSync(SECURITY_CONFIG_PATH, data, 'utf-8');
      log.info(
        {
          from: LEGACY_SECURITY_CONFIG_PATH,
          to: SECURITY_CONFIG_PATH,
        },
        'Migrated security.json to the runtime data directory'
      );
    } catch (err) {
      log.warn({ err }, 'Failed to migrate security.json from legacy path');
    }
  }
}

/** A versioned JWT secret with optional expiry for rotation grace periods */
export interface JwtSecretEntry {
  /** The secret value */
  secret: string;
  /** Monotonically increasing version number */
  version: number;
  /** ISO 8601 timestamp when this secret was created */
  createdAt: string;
  /** ISO 8601 timestamp after which this secret is no longer valid for verification */
  expiresAt?: string;
}

export interface SecurityConfig {
  /** bcrypt hash of user password */
  passwordHash?: string;
  /** SHA-256 hash of recovery key */
  recoveryKeyHash?: string;
  /** JWT signing secret (legacy single-secret field) */
  jwtSecret?: string;
  /** Current JWT secret version number */
  jwtSecretVersion?: number;
  /** Array of JWT secrets for rotation (current + previous with grace periods) */
  jwtSecrets?: JwtSecretEntry[];
  /** Whether auth is enabled (default: true after setup) */
  authEnabled?: boolean;
  /** Session timeout (e.g., "24h", "7d") */
  sessionTimeout?: string;
  /** Default "remember me" setting */
  defaultRememberMe?: boolean;
  /** When setup was completed */
  setupCompletedAt?: string;
  /** When password was last changed */
  lastPasswordChange?: string;
}

// In-memory cache
let cachedConfig: SecurityConfig | null = null;
let lastLoadTime = 0;
const CACHE_TTL_MS = 1000; // Reload every second in dev

// In-memory JWT secret (generated at runtime if not in env or config)
let runtimeJwtSecret: string | null = null;

/**
 * Load security config from disk
 */
export function getSecurityConfig(): SecurityConfig {
  migrateSecurityConfig();
  const now = Date.now();

  // Use cache in production, refresh in dev
  if (
    cachedConfig &&
    (process.env.NODE_ENV === 'production' || now - lastLoadTime < CACHE_TTL_MS)
  ) {
    return cachedConfig;
  }

  try {
    if (existsSync(SECURITY_CONFIG_PATH)) {
      const data = readFileSync(SECURITY_CONFIG_PATH, 'utf-8');
      cachedConfig = JSON.parse(data);
      lastLoadTime = now;
      return cachedConfig!;
    }
  } catch (err) {
    log.error({ err: err }, 'Error loading security config');
  }

  // Default config
  cachedConfig = {
    authEnabled: false, // Disabled until setup
  };
  lastLoadTime = now;
  return cachedConfig;
}

/** Default grace period for old secrets after rotation (7 days) */
const SECRET_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Get the current (latest) JWT signing secret.
 * Used for **signing** new tokens.
 *
 * Priority: VERITAS_JWT_SECRET env var > jwtSecrets array (latest) > legacy jwtSecret > runtime-generated
 */
export function getJwtSecret(): string {
  // 1. Environment variable (preferred — never touches disk)
  const envSecret = process.env.VERITAS_JWT_SECRET;
  if (envSecret) {
    return envSecret;
  }

  // 2. jwtSecrets array — use the highest-version (current) entry
  const config = getSecurityConfig();
  if (config.jwtSecrets && config.jwtSecrets.length > 0) {
    const sorted = [...config.jwtSecrets].sort((a, b) => b.version - a.version);
    return sorted[0].secret;
  }

  // 3. Legacy single jwtSecret field (existing installs)
  if (config.jwtSecret) {
    return config.jwtSecret;
  }

  // 4. Runtime-generated (ephemeral — sessions won't survive restart)
  if (!runtimeJwtSecret) {
    runtimeJwtSecret = crypto.randomBytes(64).toString('hex');
    log.warn(
      'JWT secret generated at runtime. Set VERITAS_JWT_SECRET env var for persistence across restarts.'
    );
  }
  return runtimeJwtSecret;
}

/**
 * Get all currently valid JWT secrets for **verification**.
 * Includes the current secret plus any previous secrets still within their grace period.
 * Returns secrets ordered by version descending (current first).
 */
export function getValidJwtSecrets(): string[] {
  // If env var is set, that's the only secret (no rotation support via env)
  const envSecret = process.env.VERITAS_JWT_SECRET;
  if (envSecret) {
    return [envSecret];
  }

  const config = getSecurityConfig();
  const now = Date.now();

  // If we have the jwtSecrets array, filter out expired entries
  if (config.jwtSecrets && config.jwtSecrets.length > 0) {
    const validEntries = config.jwtSecrets
      .filter((entry) => {
        // No expiresAt means it's the current secret — always valid
        if (!entry.expiresAt) return true;
        // Check grace period
        return new Date(entry.expiresAt).getTime() > now;
      })
      .sort((a, b) => b.version - a.version);

    if (validEntries.length > 0) {
      return validEntries.map((e) => e.secret);
    }
  }

  // Fall back to legacy single secret or runtime secret
  return [getJwtSecret()];
}

/**
 * Rotate the JWT secret.
 * - Generates a new secret and makes it the current signing key
 * - Moves the previous current secret to a grace period (default 7 days)
 * - Purges any secrets past their grace period
 * - Returns the new version number
 *
 * NOTE: Has no effect when VERITAS_JWT_SECRET env var is set (rotation
 * must be done externally in that case).
 */
export function rotateJwtSecret(gracePeriodMs: number = SECRET_GRACE_PERIOD_MS): {
  success: boolean;
  newVersion: number;
  prunedCount: number;
  message?: string;
} {
  if (process.env.VERITAS_JWT_SECRET) {
    return {
      success: false,
      newVersion: 0,
      prunedCount: 0,
      message:
        'Cannot rotate: JWT secret is managed via VERITAS_JWT_SECRET environment variable. Rotate externally.',
    };
  }

  const config = getSecurityConfig();
  const now = new Date();
  const nowISO = now.toISOString();

  // Determine current version
  let currentVersion = config.jwtSecretVersion || 0;

  // Bootstrap: if we have a legacy jwtSecret but no jwtSecrets array, migrate it
  let secrets: JwtSecretEntry[] = config.jwtSecrets ? [...config.jwtSecrets] : [];
  if (secrets.length === 0 && config.jwtSecret) {
    secrets.push({
      secret: config.jwtSecret,
      version: currentVersion || 1,
      createdAt: config.setupCompletedAt || nowISO,
    });
    if (currentVersion === 0) currentVersion = 1;
  }

  // 1. Set grace period on the current (latest) secret
  const latestEntry = secrets.find((s) => !s.expiresAt);
  if (latestEntry) {
    latestEntry.expiresAt = new Date(now.getTime() + gracePeriodMs).toISOString();
  }

  // 2. Generate new secret
  const newVersion = currentVersion + 1;
  const newSecret: JwtSecretEntry = {
    secret: crypto.randomBytes(64).toString('hex'),
    version: newVersion,
    createdAt: nowISO,
    // No expiresAt — this is now the current secret
  };
  secrets.push(newSecret);

  // 3. Prune expired secrets
  const beforeCount = secrets.length;
  secrets = secrets.filter((entry) => {
    if (!entry.expiresAt) return true;
    return new Date(entry.expiresAt).getTime() > now.getTime();
  });
  const prunedCount = beforeCount - secrets.length;

  // 4. Save updated config
  const updatedConfig: SecurityConfig = {
    ...config,
    jwtSecrets: secrets,
    jwtSecretVersion: newVersion,
    // Keep legacy field synced with current secret for backward compat
    jwtSecret: newSecret.secret,
  };
  saveSecurityConfig(updatedConfig);

  log.info(`JWT secret rotated to version ${newVersion}. ${prunedCount} expired secret(s) pruned.`);

  return {
    success: true,
    newVersion,
    prunedCount,
  };
}

/**
 * Get JWT secret rotation status (for admin diagnostics)
 */
export function getJwtRotationStatus(): {
  currentVersion: number;
  totalSecrets: number;
  validSecrets: number;
  usingEnvVar: boolean;
  secrets: Array<{ version: number; createdAt: string; expiresAt?: string; isCurrent: boolean }>;
} {
  const usingEnvVar = !!process.env.VERITAS_JWT_SECRET;
  const config = getSecurityConfig();
  const now = Date.now();

  if (usingEnvVar || !config.jwtSecrets || config.jwtSecrets.length === 0) {
    return {
      currentVersion: config.jwtSecretVersion || 0,
      totalSecrets: usingEnvVar ? 1 : config.jwtSecret ? 1 : 0,
      validSecrets: usingEnvVar ? 1 : config.jwtSecret ? 1 : 0,
      usingEnvVar,
      secrets: [],
    };
  }

  const sorted = [...config.jwtSecrets].sort((a, b) => b.version - a.version);
  const currentVersion = sorted[0].version;

  return {
    currentVersion,
    totalSecrets: sorted.length,
    validSecrets: sorted.filter((s) => !s.expiresAt || new Date(s.expiresAt).getTime() > now)
      .length,
    usingEnvVar,
    secrets: sorted.map((s) => ({
      version: s.version,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      isCurrent: s.version === currentVersion && !s.expiresAt,
    })),
  };
}

/**
 * Save security config to disk
 */
export function saveSecurityConfig(config: SecurityConfig): void {
  try {
    // Ensure data directory exists
    if (!existsSync(RUNTIME_DIR)) {
      mkdirSync(RUNTIME_DIR, { recursive: true });
    }

    // Write atomically (write to temp, then rename)
    const tempPath = SECURITY_CONFIG_PATH + '.tmp';
    writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf-8');
    renameSync(tempPath, SECURITY_CONFIG_PATH);

    // Update cache
    cachedConfig = config;
    lastLoadTime = Date.now();

    log.info('Security config saved');
  } catch (err) {
    log.error({ err: err }, 'Error saving security config');
    throw err;
  }
}

/**
 * Generate a random recovery key
 * Format: XXXX-XXXX-XXXX-XXXX (16 alphanumeric chars)
 */
export function generateRecoveryKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Omit confusing chars (0/O, 1/I/L)
  let key = '';
  const bytes = crypto.randomBytes(16);

  for (let i = 0; i < 16; i++) {
    key += chars[bytes[i] % chars.length];
    if (i === 3 || i === 7 || i === 11) {
      key += '-';
    }
  }

  return key;
}

/**
 * Hash a recovery key (SHA-256)
 * We use SHA-256 instead of bcrypt for recovery keys because:
 * 1. Recovery keys are high-entropy (not user-chosen)
 * 2. We need constant-time comparison
 * 3. Faster verification for one-time use keys
 */
export function hashRecoveryKey(key: string): string {
  // Normalize: remove dashes, uppercase
  const normalized = key.replace(/-/g, '').toUpperCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Clear all security settings (for CLI reset)
 */
export function resetSecurityConfig(): void {
  const newConfig: SecurityConfig = {
    authEnabled: false,
  };
  saveSecurityConfig(newConfig);
  runtimeJwtSecret = null;
  log.info('Security config reset. Next load will show setup screen.');
}

/** Warning about JWT secret configuration */
export interface JwtSecretWarning {
  level: 'critical' | 'warning' | 'info';
  message: string;
}

/**
 * Check JWT secret configuration and return startup warnings.
 * Returns an array of warnings (empty if the secret is properly configured).
 */
export function checkJwtSecretConfig(): JwtSecretWarning[] {
  const warnings: JwtSecretWarning[] = [];
  const envSecret = process.env.VERITAS_JWT_SECRET;

  if (envSecret) {
    // Env var set — best practice
    if (envSecret.length < 64) {
      warnings.push({
        level: 'warning',
        message: `VERITAS_JWT_SECRET is only ${envSecret.length} characters. Recommend at least 64 characters (use: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")`,
      });
    }
    return warnings;
  }

  // Check if security.json has a persisted secret
  const config = getSecurityConfig();
  if (config.jwtSecrets && config.jwtSecrets.length > 0) {
    warnings.push({
      level: 'info',
      message:
        'JWT secret loaded from security.json. Consider setting VERITAS_JWT_SECRET env var for explicit configuration.',
    });
    return warnings;
  }
  if (config.jwtSecret) {
    warnings.push({
      level: 'info',
      message:
        'JWT secret loaded from security.json (legacy format). Consider setting VERITAS_JWT_SECRET env var.',
    });
    return warnings;
  }

  // No env var, no persisted config — will be ephemeral
  warnings.push({
    level: 'critical',
    message:
      'No VERITAS_JWT_SECRET env var set and no persisted secret found. JWT secret will be generated at runtime (ephemeral) — all sessions will be invalidated on server restart. Set VERITAS_JWT_SECRET in .env for persistence.',
  });

  return warnings;
}

/**
 * Check if password is configured
 */
export function isPasswordConfigured(): boolean {
  const config = getSecurityConfig();
  return !!config.passwordHash;
}
