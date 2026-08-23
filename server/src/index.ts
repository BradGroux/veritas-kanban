import 'dotenv/config';

import { validateEnv } from './config/env.js';
import { executeScheduledSqliteJournalMaintenance } from './storage/sqlite/journal-maintenance-service.js';
import { migrateLegacyRuntimeState } from './utils/migrate-legacy-runtime.js';

validateEnv();
await migrateLegacyRuntimeState();
await executeScheduledSqliteJournalMaintenance();
await import('./server.js');
