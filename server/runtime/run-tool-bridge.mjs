#!/usr/bin/env node

import readline from 'node:readline';
import { readFileSync } from 'node:fs';

const MAX_RECORD_BYTES = 1024 * 1024;
const PROTOCOL_VERSION = '2025-06-18';
const HANDLE_PATTERN = /^vkbridge_[A-Za-z0-9_-]{32,}$/;
const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TOOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const packageVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

const tools = [
  {
    name: 'get_run_tool_catalog',
    description: 'Read the immutable tool catalog bound to this exact Veritas run',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'call_run_tool',
    description:
      'Invoke an allowed tool through this run authority with policy, approval, credential, redaction, and causal event enforcement',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' },
        tool: { type: 'string' },
        arguments: { type: 'object', additionalProperties: true },
        operationId: { type: 'string' },
        approvalId: { type: 'string' },
      },
      required: ['serverId', 'tool', 'arguments', 'operationId'],
      additionalProperties: false,
    },
  },
];

const handle = process.env.VK_RUN_TOOL_BRIDGE_HANDLE;
const apiUrl = normalizeApiUrl(process.env.VK_API_URL || 'http://localhost:3001');
if (!HANDLE_PATTERN.test(handle || '')) {
  throw new Error('Run tool bridge handle is missing or invalid.');
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  void accept(line);
});
input.on('close', () => {
  process.exitCode = 0;
});

async function accept(line) {
  if (!line.trim()) return;
  if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
    writeError(null, -32600, 'MCP request exceeded the bounded record limit.');
    return;
  }
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    writeError(null, -32700, 'MCP request was not valid JSON.');
    return;
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    writeError(null, -32600, 'MCP request must be a JSON object.');
    return;
  }
  if (!Object.hasOwn(record, 'id')) return;
  try {
    writeResult(record.id, await dispatch(record.method, record.params));
  } catch (error) {
    writeError(
      record.id,
      error instanceof InvalidParamsError ? -32602 : -32603,
      error instanceof Error ? error.message : 'Run tool bridge request failed.'
    );
  }
}

async function dispatch(method, params) {
  if (method === 'initialize') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'veritas-run-tools', version: packageVersion },
    };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') {
    assertEmptyObject(params);
    return { tools };
  }
  if (method === 'tools/call') {
    const call = object(params, 'tools/call params');
    const name = string(call.name, 'tools/call name');
    if (!['get_run_tool_catalog', 'call_run_tool'].includes(name)) {
      throw new InvalidParamsError(`Unknown run tool bridge action: ${name}`);
    }
    const argumentsValue = call.arguments ?? {};
    const content =
      name === 'get_run_tool_catalog'
        ? await request('/api/run-tool-bridge/catalog')
        : await request('/api/run-tool-bridge/call', {
            method: 'POST',
            body: JSON.stringify(parseCall(argumentsValue)),
          });
    return {
      content: [{ type: 'text', text: JSON.stringify(content, null, 2) }],
    };
  }
  throw new InvalidParamsError(`Unsupported MCP method: ${String(method)}`);
}

async function request(requestPath, options = {}) {
  const response = await fetch(`${apiUrl}${requestPath}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-vk-run-tool-bridge': handle,
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(apiError(body) || `Run tool bridge request failed (${response.status}).`);
  }
  if (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    body.success === true &&
    Object.hasOwn(body, 'data')
  ) {
    return body.data;
  }
  return body;
}

function parseCall(value) {
  const call = object(value, 'call_run_tool arguments');
  const serverId = string(call.serverId, 'serverId');
  const tool = string(call.tool, 'tool');
  const operationId = string(call.operationId, 'operationId');
  const argumentsValue = object(call.arguments, 'arguments');
  const approvalId =
    call.approvalId === undefined ? undefined : string(call.approvalId, 'approvalId');
  if (!SERVER_ID_PATTERN.test(serverId)) throw new InvalidParamsError('serverId is invalid.');
  if (!TOOL_PATTERN.test(tool)) throw new InvalidParamsError('tool is invalid.');
  if (!OPERATION_PATTERN.test(operationId)) throw new InvalidParamsError('operationId is invalid.');
  if (approvalId && !OPERATION_PATTERN.test(approvalId)) {
    throw new InvalidParamsError('approvalId is invalid.');
  }
  const allowed = new Set(['serverId', 'tool', 'arguments', 'operationId', 'approvalId']);
  if (Object.keys(call).some((key) => !allowed.has(key))) {
    throw new InvalidParamsError('call_run_tool contains unsupported fields.');
  }
  return {
    serverId,
    tool,
    arguments: argumentsValue,
    operationId,
    ...(approvalId ? { approvalId } : {}),
  };
}

function assertEmptyObject(value) {
  const inputValue = value ?? {};
  if (
    !inputValue ||
    typeof inputValue !== 'object' ||
    Array.isArray(inputValue) ||
    Object.keys(inputValue).length > 0
  ) {
    throw new InvalidParamsError('Expected an empty object.');
  }
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidParamsError(`${label} must be an object.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidParamsError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeApiUrl(value) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Run tool bridge API URL must use HTTPS or loopback HTTP.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function apiError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const envelope =
    value.error && typeof value.error === 'object' && !Array.isArray(value.error)
      ? value.error
      : undefined;
  const message =
    (typeof envelope?.message === 'string' && envelope.message) ||
    (typeof value.message === 'string' && value.message) ||
    (typeof value.error === 'string' && value.error);
  if (!message) return undefined;
  const details = envelope?.details ?? value.details;
  return details === undefined ? message : `${message} ${JSON.stringify(details)}`;
}

function writeResult(id, result) {
  write({ jsonrpc: '2.0', id, result });
}

function writeError(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } });
}

function write(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

class InvalidParamsError extends Error {}
