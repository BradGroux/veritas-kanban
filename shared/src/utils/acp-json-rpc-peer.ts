import type { AcpJsonRpcFailure, AcpJsonRpcId, AcpJsonRpcMessage } from '../types/acp.types.js';

const DEFAULT_MAX_RECORD_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface AcpJsonRpcPeerOptions {
  write(record: AcpJsonRpcMessage): void | Promise<void>;
  maxRecordBytes?: number;
  requestTimeoutMs?: number;
  onRequest?: (method: string, params: unknown, id: AcpJsonRpcId) => unknown | Promise<unknown>;
  onNotification?: (method: string, params: unknown) => void | Promise<void>;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class AcpJsonRpcPeer {
  private readonly pending = new Map<AcpJsonRpcId, PendingRequest>();
  private readonly maxRecordBytes: number;
  private readonly requestTimeoutMs: number;
  private nextId = 1;
  private buffer = '';
  private closed = false;
  private writes = Promise.resolve();

  constructor(private readonly options: AcpJsonRpcPeerOptions) {
    this.maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.closed) return Promise.reject(new Error('ACP connection is closed.'));
    const id = this.nextId++;
    const response = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP request ${method} timed out.`));
      }, timeoutMs ?? this.requestTimeoutMs);
      timer.unref();
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
    });
    void this.send({ jsonrpc: '2.0', id, method, params }).catch((error) => {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    });
    return response;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) throw new Error('ACP connection is closed.');
    await this.send({ jsonrpc: '2.0', method, params });
  }

  acceptChunk(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, 'utf8') > this.maxRecordBytes) {
        this.close(new Error('ACP input exceeded the bounded record limit.'));
        return;
      }
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        void this.send(jsonRpcError(null, -32700, 'Parse error'));
        continue;
      }
      this.acceptRecord(record);
    }
    if (Buffer.byteLength(this.buffer, 'utf8') > this.maxRecordBytes) {
      this.close(new Error('ACP input exceeded the bounded record limit.'));
    }
  }

  close(error: Error = new Error('ACP connection closed.')): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer = '';
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private acceptRecord(value: unknown): void {
    if (!isRecord(value) || value.jsonrpc !== '2.0') {
      void this.send(jsonRpcError(null, -32600, 'Invalid Request'));
      return;
    }
    const id = jsonRpcId(value.id);
    if (id !== undefined && ('result' in value || 'error' in value) && !('method' in value)) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if ('error' in value && value.error !== undefined) {
        pending.reject(new Error(jsonRpcErrorMessage(value.error)));
      } else {
        pending.resolve(value.result);
      }
      return;
    }

    if (typeof value.method !== 'string' || !value.method.trim()) {
      if (id !== undefined) void this.send(jsonRpcError(id, -32600, 'Invalid Request'));
      return;
    }
    if (id === undefined) {
      void Promise.resolve(this.options.onNotification?.(value.method, value.params)).catch(() => {
        // Notifications do not receive JSON-RPC error responses.
      });
      return;
    }
    if (!this.options.onRequest) {
      void this.send(jsonRpcError(id, -32601, 'Method not found'));
      return;
    }
    void Promise.resolve(this.options.onRequest(value.method, value.params, id))
      .then((result) => this.send({ jsonrpc: '2.0', id, result: result ?? {} }))
      .catch((error) =>
        this.send(jsonRpcError(id, -32603, boundedMessage(error, 'Internal error')))
      );
  }

  private send(record: AcpJsonRpcMessage): Promise<void> {
    const encoded = JSON.stringify(record);
    if (Buffer.byteLength(encoded, 'utf8') > this.maxRecordBytes) {
      return Promise.reject(new Error('ACP output exceeded the bounded record limit.'));
    }
    const write = this.writes.then(() => this.options.write(record));
    this.writes = write.then(
      () => undefined,
      () => undefined
    );
    return write;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonRpcId(value: unknown): AcpJsonRpcId | undefined {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : undefined;
}

function jsonRpcError(id: AcpJsonRpcId | null, code: number, message: string): AcpJsonRpcFailure {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function jsonRpcErrorMessage(value: unknown): string {
  if (!isRecord(value)) return 'ACP request failed.';
  return boundedMessage(value.message, 'ACP request failed.');
}

function boundedMessage(value: unknown, fallback: string): string {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  return (message.trim() || fallback).slice(0, 1_000);
}
