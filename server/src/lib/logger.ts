import pino from 'pino';
import { redactSerializers, PINO_REDACT_PATHS } from './redact.js';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Structured logger using pino.
 *
 * - JSON output in production (machine-readable for log aggregators)
 * - pino-pretty in development (human-readable, colorized)
 * - Log level controlled via LOG_LEVEL env var (default: 'info')
 * - Includes timestamp, pid, hostname in every log line
 * - Sensitive fields (auth tokens, API keys, secrets) are automatically
 *   redacted via custom serializers and pino's built-in redact option.
 *
 * @see lib/redact.ts — redaction patterns and serializer definitions
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  serializers: {
    ...pino.stdSerializers,
    ...redactSerializers,
  },
  redact: {
    paths: PINO_REDACT_PATHS,
    censor: '[REDACTED]',
  },
  // pino includes pid and hostname by default in JSON mode.
  // In dev we use pino-pretty as a transport for colorized output.
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        // Production: JSON with explicit ISO timestamp
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
});

/**
 * Create a child logger scoped to a specific module / component.
 * Usage:
 *   const log = createLogger('auth');
 *   log.info({ role: 'admin' }, 'User authenticated');
 */
export function createLogger(component: string) {
  return logger.child({ component });
}

export default logger;
