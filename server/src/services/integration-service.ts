/**
 * Integration storage service.
 *
 * Manages integration config (.veritas-kanban/integrations.json) and
 * secrets (.veritas-kanban/secrets/<provider>.json), separated for security.
 */
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../lib/logger.js';
import type {
  IntegrationConfig,
  IntegrationSecrets,
  IntegrationsFile,
  IntegrationProviderId,
  FieldMapping,
} from '../integrations/index.js';

const log = createLogger('integration-service');

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CONFIG_DIR = path.join(PROJECT_ROOT, '.veritas-kanban');
const INTEGRATIONS_FILE = path.join(CONFIG_DIR, 'integrations.json');
const SECRETS_DIR = path.join(CONFIG_DIR, 'secrets');

const DEFAULT_FIELD_MAPPING: FieldMapping = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  dueDate: 'dueDate',
};

const EMPTY_FILE: IntegrationsFile = {
  version: 1,
  integrations: [],
};

/** Ensure directories exist. */
async function ensureDirs(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.mkdir(SECRETS_DIR, { recursive: true, mode: 0o700 });
}

/** Read the integrations config file. */
export async function getIntegrationsConfig(): Promise<IntegrationsFile> {
  try {
    const raw = await fs.readFile(INTEGRATIONS_FILE, 'utf-8');
    return JSON.parse(raw) as IntegrationsFile;
  } catch {
    return { ...EMPTY_FILE, integrations: [] };
  }
}

/** Write the integrations config file. */
async function writeIntegrationsConfig(config: IntegrationsFile): Promise<void> {
  await ensureDirs();
  await fs.writeFile(INTEGRATIONS_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/** Get config for a specific provider. */
export async function getIntegrationConfig(
  providerId: IntegrationProviderId
): Promise<IntegrationConfig | undefined> {
  const file = await getIntegrationsConfig();
  return file.integrations.find((i) => i.providerId === providerId);
}

/** Save/update config for a specific provider. */
export async function saveIntegrationConfig(config: IntegrationConfig): Promise<void> {
  const file = await getIntegrationsConfig();
  const idx = file.integrations.findIndex((i) => i.providerId === config.providerId);
  if (idx >= 0) {
    file.integrations[idx] = config;
  } else {
    file.integrations.push(config);
  }
  await writeIntegrationsConfig(file);
  log.info({ providerId: config.providerId, status: config.status }, 'Integration config saved');
}

/** Remove config for a specific provider. */
export async function removeIntegrationConfig(providerId: IntegrationProviderId): Promise<void> {
  const file = await getIntegrationsConfig();
  file.integrations = file.integrations.filter((i) => i.providerId !== providerId);
  await writeIntegrationsConfig(file);
  log.info({ providerId }, 'Integration config removed');
}

/** Read secrets for a provider. */
export async function getSecrets(providerId: IntegrationProviderId): Promise<IntegrationSecrets> {
  const secretFile = path.join(SECRETS_DIR, `${providerId}.json`);
  try {
    const raw = await fs.readFile(secretFile, 'utf-8');
    return JSON.parse(raw) as IntegrationSecrets;
  } catch {
    return {};
  }
}

/** Save secrets for a provider. */
export async function saveSecrets(
  providerId: IntegrationProviderId,
  secrets: IntegrationSecrets
): Promise<void> {
  await ensureDirs();
  const secretFile = path.join(SECRETS_DIR, `${providerId}.json`);
  await fs.writeFile(secretFile, JSON.stringify(secrets, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  log.info({ providerId }, 'Integration secrets saved');
}

/** Delete secrets for a provider. */
export async function deleteSecrets(providerId: IntegrationProviderId): Promise<void> {
  const secretFile = path.join(SECRETS_DIR, `${providerId}.json`);
  try {
    await fs.unlink(secretFile);
    log.info({ providerId }, 'Integration secrets deleted');
  } catch {
    // File may not exist — that's fine
  }
}

/** Create a default IntegrationConfig for a new connection. */
export function createDefaultConfig(providerId: IntegrationProviderId): IntegrationConfig {
  return {
    providerId,
    enabled: true,
    status: 'disconnected',
    fieldMapping: { ...DEFAULT_FIELD_MAPPING },
    providerConfig: {},
  };
}
