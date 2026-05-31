import { EventEmitter } from 'node:events';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import type { ManagedProcessConfig, ManagedProcessSnapshot, DesktopProcessState } from './types.js';

export class ProcessSupervisor extends EventEmitter {
  private child: ChildProcess | null = null;
  private state: DesktopProcessState = 'idle';
  private lastError: string | null = null;
  private startedAt: string | null = null;
  private exitedAt: string | null = null;
  private logStream: WriteStream | null = null;
  private stopping = false;

  constructor(private readonly config: ManagedProcessConfig) {
    super();
  }

  snapshot(): ManagedProcessSnapshot {
    return {
      name: this.config.name,
      state: this.state,
      pid: this.child?.pid ?? null,
      port: this.config.readyUrl ? Number(new URL(this.config.readyUrl).port) : null,
      lastError: this.lastError,
      startedAt: this.startedAt,
      exitedAt: this.exitedAt,
    };
  }

  async start(): Promise<void> {
    if (this.child) return;

    await mkdir(path.dirname(this.config.logFile), { recursive: true });
    this.logStream = createWriteStream(this.config.logFile, { flags: 'a' });
    this.setState('starting');
    this.stopping = false;
    this.startedAt = new Date().toISOString();
    this.exitedAt = null;
    this.lastError = null;

    const child = spawn(this.config.command, this.config.args, {
      cwd: this.config.cwd,
      env: this.config.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child = child;
    this.log(`[desktop] started ${this.config.command} ${this.config.args.join(' ')}\n`);
    child.stdout?.on('data', (chunk: Buffer) => this.log(chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.log(chunk));

    child.once('error', (error) => {
      this.lastError = error.message;
      this.setState('failed');
      this.emit('error', error);
    });

    child.once('exit', (code, signal) => {
      this.exitedAt = new Date().toISOString();
      this.log(`[desktop] exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
      this.child = null;
      this.closeLogStream();
      if (this.stopping || code === 0) {
        this.setState('stopped');
        return;
      }
      this.lastError = `${this.config.name} exited unexpectedly with code ${code ?? 'null'} signal ${signal ?? 'null'}`;
      this.setState('failed');
    });
  }

  markReady(): void {
    if (this.child) {
      this.setState('ready');
    }
  }

  async stop(): Promise<void> {
    if (!this.child) {
      this.setState('stopped');
      return;
    }

    this.stopping = true;
    this.setState('stopping');
    const child = this.child;
    const timeoutMs = this.config.shutdownTimeoutMs ?? 5000;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, timeoutMs);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      child.kill('SIGTERM');
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private setState(state: DesktopProcessState): void {
    this.state = state;
    this.emit('state', this.snapshot());
  }

  private log(chunk: Buffer | string): void {
    this.logStream?.write(chunk);
  }

  private closeLogStream(): void {
    this.logStream?.end();
    this.logStream = null;
  }
}
