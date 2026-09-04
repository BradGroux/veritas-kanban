import type { Server } from 'node:http';

/** One shutdown owns the listener drain and dependent service disposal. */
export function createServerShutdown(options: {
  server: Server;
  closeWebSockets: () => Promise<void>;
  disposeServices: () => Promise<void>;
  timeoutMs?: number;
}): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    pending ??= Promise.resolve().then(async () => {
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error('Graceful shutdown deadline exceeded'));
        }, options.timeoutMs ?? 10_000);
      });
      // Stop accepting TCP connections immediately, but let already-connected
      // HTTP work finish while its services and storage are still available.
      const httpClosed = new Promise<void>((resolve, reject) => {
        options.server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING')
            reject(error);
          else resolve();
        });
      });
      try {
        await Promise.race([
          deadline,
          (async () => {
            await Promise.all([httpClosed, options.closeWebSockets()]);
            // A late drain must not dispose storage after the deadline failed.
            if (!expired) await options.disposeServices();
          })(),
        ]);
      } finally {
        clearTimeout(timer);
      }
    });
    return pending;
  };
}
