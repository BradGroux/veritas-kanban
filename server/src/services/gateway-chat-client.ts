/**
 * Gateway Chat Client
 *
 * Connects to the Clawdbot Gateway WebSocket to proxy chat messages.
 * Handles authentication, message sending, and response collection.
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { createLogger } from '../lib/logger.js';

const log = createLogger('gateway-chat');

const GATEWAY_URL = process.env.CLAWDBOT_GATEWAY || 'http://127.0.0.1:18789';
const PROTOCOL_VERSION = 3;
const CONNECT_TIMEOUT_MS = 10_000;
const RESPONSE_TIMEOUT_MS = 120_000; // 2 minutes for AI response

// Cached token — populated lazily
let cachedToken: string | null = null;

function getToken(): string {
  if (cachedToken) return cachedToken;
  return process.env.CLAWDBOT_GATEWAY_TOKEN || '';
}

interface ChatResponse {
  text: string;
  usage?: Record<string, unknown>;
  error?: string;
}

interface StreamCallbacks {
  onDelta?: (text: string) => void;
  onFinal?: (response: ChatResponse) => void;
  onError?: (error: string) => void;
}

/**
 * Send a message to the Clawdbot Gateway and collect the response.
 * Opens a temporary WebSocket connection for each request.
 */
export async function sendGatewayChat(
  message: string,
  sessionKey: string,
  callbacks?: StreamCallbacks
): Promise<ChatResponse> {
  const wsUrl = GATEWAY_URL.replace(/^http/, 'ws');

  return new Promise((resolve, reject) => {
    let connected = false;
    let settled = false;
    let responseText = '';
    let responseUsage: Record<string, unknown> | undefined;
    let connectTimer: ReturnType<typeof setTimeout>;
    let responseTimer: ReturnType<typeof setTimeout>;

    const ws = new WebSocket(wsUrl);

    const cleanup = () => {
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };

    const safeReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const safeResolve = (value: ChatResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    connectTimer = setTimeout(() => {
      if (!connected) {
        const err = 'Gateway connection timeout';
        callbacks?.onError?.(err);
        safeReject(new Error(err));
      }
    }, CONNECT_TIMEOUT_MS);

    ws.on('error', (err) => {
      log.error({ err: err.message }, 'Gateway WebSocket error');
      const errMsg = `Gateway connection failed: ${err.message}`;
      callbacks?.onError?.(errMsg);
      safeReject(new Error(errMsg));
    });

    ws.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      // Step 1: Handle challenge → send connect
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        ws.send(
          JSON.stringify({
            type: 'req',
            id: randomUUID(),
            method: 'connect',
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: 'gateway-client',
                version: '1.0.0',
                platform: 'node',
                mode: 'backend',
              },
              auth: { token: getToken() },
            },
          })
        );
        return;
      }

      // Step 2: Handle connect response → send chat.send
      if (msg.type === 'res' && msg.ok && msg.payload?.type === 'hello-ok') {
        connected = true;
        clearTimeout(connectTimer);

        log.info({ sessionKey }, 'Connected to gateway, sending chat message');

        // Start response timeout
        responseTimer = setTimeout(() => {
          const err = 'Gateway response timeout';
          callbacks?.onError?.(err);
          safeReject(new Error(err));
        }, RESPONSE_TIMEOUT_MS);

        ws.send(
          JSON.stringify({
            type: 'req',
            id: randomUUID(),
            method: 'chat.send',
            params: {
              sessionKey,
              message,
              idempotencyKey: randomUUID(),
            },
          })
        );
        return;
      }

      // Handle chat.send ack
      if (msg.type === 'res' && msg.ok && msg.payload?.runId) {
        log.debug({ runId: msg.payload.runId }, 'Chat run started');
        return;
      }

      // Handle errors
      if (msg.type === 'res' && !msg.ok) {
        const errMsg = msg.error?.message || 'Unknown gateway error';
        log.error({ error: msg.error }, 'Gateway error');
        callbacks?.onError?.(errMsg);
        safeReject(new Error(errMsg));
        return;
      }

      // Step 3: Handle streaming chat events
      if (msg.type === 'event' && msg.event === 'chat') {
        const payload = msg.payload || {};

        if (payload.state === 'delta') {
          // Gateway sends full accumulated text in each delta, not incremental chunks
          const content = payload.message?.content;
          if (Array.isArray(content)) {
            let fullText = '';
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                fullText += block.text;
              }
            }
            // Calculate the new chunk (what was added since last delta)
            const newChunk = fullText.slice(responseText.length);
            responseText = fullText;
            if (newChunk) {
              callbacks?.onDelta?.(newChunk);
            }
          }
        }

        if (payload.state === 'final') {
          // Extract final text if we didn't get it from deltas
          if (!responseText && payload.message?.content) {
            const content = payload.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  responseText += block.text;
                }
              }
            } else if (typeof content === 'string') {
              responseText = content;
            }
          }

          responseUsage = payload.usage;

          const response: ChatResponse = {
            text: responseText,
            usage: responseUsage,
          };

          log.info({ sessionKey, textLength: responseText.length }, 'Chat response complete');
          callbacks?.onFinal?.(response);
          safeResolve(response);
          return;
        }

        if (payload.state === 'error') {
          const errMsg = payload.errorMessage || 'Chat error';
          callbacks?.onError?.(errMsg);
          safeReject(new Error(errMsg));
          return;
        }

        if (payload.state === 'aborted') {
          const response: ChatResponse = {
            text: responseText || '(response aborted)',
          };
          callbacks?.onFinal?.(response);
          safeResolve(response);
          return;
        }
      }
    });

    ws.on('close', () => {
      if (!connected) {
        safeReject(new Error('Gateway WebSocket closed before connecting'));
      }
    });
  });
}

/**
 * Load the gateway token from config file if not in env
 */
export async function loadGatewayToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  if (process.env.CLAWDBOT_GATEWAY_TOKEN) {
    cachedToken = process.env.CLAWDBOT_GATEWAY_TOKEN;
    return cachedToken;
  }

  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const configPath = path.join(process.env.HOME || '', '.clawdbot', 'clawdbot.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const token = config?.gateway?.auth?.token;
    if (token) {
      cachedToken = token;
      process.env.CLAWDBOT_GATEWAY_TOKEN = token;
      return token;
    }
  } catch (err: any) {
    log.warn({ err: err.message }, 'Failed to load gateway token from config');
  }

  return '';
}
