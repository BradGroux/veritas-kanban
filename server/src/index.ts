import 'dotenv/config';

import { validateEnv } from './config/env.js';
import { executeScheduledSqliteJournalMaintenance } from './storage/sqlite/journal-maintenance-service.js';

validateEnv();
await executeScheduledSqliteJournalMaintenance();
await import('./server.js');
