import { z } from 'zod';

const optionalTrimmed = (max: number) => z.string().trim().min(1).max(max).optional();

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

const commandTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine(
    (value) => !hasControlCharacters(value),
    'Command values cannot contain control characters'
  );

function isBuzzExecutable(value: string): boolean {
  const executableName = value.split(/[\\/]/).at(-1)?.toLowerCase();
  return /^(?:buzz|buzz-acp|buzz-agent)(?:\.exe)?$/.test(executableName ?? '');
}

const buzzCommandSchema = z
  .object({
    executable: commandTextSchema,
    args: z.array(commandTextSchema).max(64).optional(),
  })
  .strict()
  .superRefine((command, context) => {
    if (!isBuzzExecutable(command.executable)) {
      context.addIssue({
        code: 'custom',
        path: ['executable'],
        message: 'Configured command must be a buzz, buzz-acp, or buzz-agent executable',
      });
    }
    const credentialPattern = /(?:private[-_]?key|secret|token|authorization|bearer|nsec1)/i;
    const secretHexPattern = /\b(?:[a-f0-9]{128}|[a-f0-9]{64})\b/i;
    const executableUnsafe =
      credentialPattern.test(command.executable) || secretHexPattern.test(command.executable);
    const argumentUnsafe = command.args?.some(
      (value) => credentialPattern.test(value) || secretHexPattern.test(value)
    );
    if (executableUnsafe || argumentUnsafe) {
      context.addIssue({
        code: 'custom',
        path: [executableUnsafe ? 'executable' : 'args'],
        message: 'Command configuration cannot contain credential material or credential flags',
      });
    }
  });

const environmentReferenceSchema = z
  .string()
  .trim()
  .regex(/^env:[A-Za-z_][A-Za-z0-9_]*$/, 'Secret references must use env:VARIABLE_NAME syntax');

const relayUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => !hasControlCharacters(value), 'Relay URL cannot contain control characters')
  .superRefine((value, context) => {
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
        context.addIssue({
          code: 'custom',
          message: 'Relay URL must use http, https, ws, or wss',
        });
      }
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        context.addIssue({
          code: 'custom',
          message: 'Relay URL cannot contain credentials, a query string, or a fragment',
        });
      }
      if (!parsed.hostname) {
        context.addIssue({ code: 'custom', message: 'Relay URL must include a host' });
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'Relay URL is invalid' });
    }
  });

const teamsAdapterConfigSchema = z
  .object({
    kind: z.literal('msteams').optional(),
    displayName: optionalTrimmed(200),
    enabled: z.boolean().optional(),
    deliveryMode: z.enum(['manual', 'webhook']).optional(),
    destinationType: z.enum(['channel', 'direct']).optional(),
    tenantId: optionalTrimmed(500),
    teamId: optionalTrimmed(500),
    channelId: optionalTrimmed(500),
    chatId: optionalTrimmed(500),
    webhookUrl: optionalTrimmed(2048),
    credential: optionalTrimmed(4096),
  })
  .strict();

export const buzzAdapterConfigSchema = z
  .object({
    kind: z.literal('buzz'),
    displayName: optionalTrimmed(200),
    enabled: z.boolean().optional(),
    relayHttpUrl: relayUrlSchema,
    relayWebSocketUrl: relayUrlSchema.nullable().optional(),
    expectedCommunity: optionalTrimmed(500).nullable(),
    publicKey: z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{64}$/, 'Buzz public key must be 64 hexadecimal characters'),
    credentialRef: environmentReferenceSchema,
    authTagRef: environmentReferenceSchema.nullable().optional(),
    allowLocalhost: z.boolean().optional(),
    allowPrivateNetwork: z.boolean().optional(),
    command: buzzCommandSchema.nullable().optional(),
  })
  .strict();

export const communicationAdapterConfigSchema = z.union([
  buzzAdapterConfigSchema,
  teamsAdapterConfigSchema,
]);

export type CommunicationAdapterConfig = z.infer<typeof communicationAdapterConfigSchema>;
export type BuzzAdapterConfig = z.infer<typeof buzzAdapterConfigSchema>;
