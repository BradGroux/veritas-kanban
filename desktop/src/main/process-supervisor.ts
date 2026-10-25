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
      if (!child.pid && this.child === child) {
        this.child = null;
        this.closeLogStream();
        this.exitedAt = new Date().toISOString();
      }
      this.lastError = error.message;
      this.setState('failed');
      this.emit('error', error);
    });

    child.once('exit', (code, signal) => {
      this.exitedAt = new Date().toISOString();
      this.log(`[desktop] exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
      const wasReady = this.state === 'ready';
      this.child = null;
      this.closeLogStream();
      if (this.stopping || (code === 0 && wasReady)) {
        this.setState('stopped');
        return;
      }
      const exitDetail = `code ${code ?? 'null'} signal ${signal ?? 'null'}`;
      this.lastError = wasReady
        ? `${this.config.name} exited unexpectedly with ${exitDetail}`
        : `${this.config.name} exited before becoming ready with ${exitDetail}`;
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

    const child = this.child;
    if (child.exitCode !== null || child.signalCode !== null) {
      this.setState('stopped');
      return;
    }
    this.stopping = true;
    this.setState('stopping');
    const timeoutMs = this.config.shutdownTimeoutMs ?? 5000;

    await new Promise<void>((resolve, reject) => {
      const hasExited = () => child.exitCode !== null || child.signalCode !== null;
      const cleanup = () => {
        clearTimeout(timeout);
        child.off('exit', onExit);
        child.off('close', onExit);
        child.off('error', onError);
      };
      const onExit = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        // A failed spawn has no process to reap. Signal failures must remain visible.
        if (!child.pid || hasExited()) {
          this.setState('stopped');
          resolve();
        } else reject(error);
      };
      const sendSignal = (signal: NodeJS.Signals) => {
        try {
          child.kill(signal);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const timeout = setTimeout(() => {
        if (this.child === child && child.pid && !hasExited()) sendSignal('SIGKILL');
      }, timeoutMs);

      child.once('exit', onExit);
      child.once('close', onExit);
      child.once('error', onError);
      // killed records signal delivery, not exit; only observed lifecycle state
      // can suppress escalation for this exact owned ChildProcess.
      if (hasExited()) onExit();
      else if (child.pid) sendSignal('SIGTERM');
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
