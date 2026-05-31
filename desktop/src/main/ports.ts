import net from 'node:net';

export async function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

export async function findAvailablePort(
  preferredPort: number,
  host = '127.0.0.1',
  maxAttempts = 50
): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = preferredPort + offset;
    if (await isPortAvailable(candidate, host)) {
      return candidate;
    }
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address) {
          resolve(address.port);
          return;
        }
        reject(new Error('Unable to allocate an ephemeral port'));
      });
    });
    server.listen(0, host);
  });
}
