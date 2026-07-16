import net from 'node:net';

async function isPortAcceptingConnections(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ port, host });
    const finish = (accepting: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(accepting);
    };

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });
}

async function isPortAvailableOnHost(port: number, host: string): Promise<boolean> {
  // macOS can allow a specific-address bind beside an existing IPv6 wildcard
  // listener. Probe for an accepting server before trusting the bind check.
  if (await isPortAcceptingConnections(port, host)) {
    return false;
  }

  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (host === '::1' && (error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL')) {
        resolve(true);
        return;
      }
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function isPortAvailableOnComplementaryHost(port: number, host: string): Promise<boolean> {
  return host === '127.0.0.1' ? isPortAvailableOnHost(port, '::1') : true;
}

export async function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  if (!(await isPortAvailableOnHost(port, host))) {
    return false;
  }

  // Chromium can reach an IPv6 wildcard listener even when the renderer URL
  // names 127.0.0.1. Reject the candidate if either loopback family is busy so
  // the desktop app cannot attach to an unrelated local Veritas/dev server.
  return isPortAvailableOnComplementaryHost(port, host);
}

export async function findAvailablePort(
  preferredPort: number,
  host = '127.0.0.1',
  maxAttempts = 50,
  excludedPorts: ReadonlySet<number> = new Set()
): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = preferredPort + offset;
    if (excludedPorts.has(candidate)) {
      continue;
    }
    if (await isPortAvailable(candidate, host)) {
      return candidate;
    }
  }

  const reservations: net.Server[] = [];
  try {
    // Keep rejected reservations open so the OS cannot hand the same
    // ephemeral candidate back to a later attempt. The extra attempts cover
    // candidates rejected by the complementary-family collision probe.
    const fallbackAttempts = excludedPorts.size + 50;
    for (let attempt = 0; attempt < fallbackAttempts; attempt += 1) {
      const reservation = net.createServer();
      const port = await new Promise<number>((resolve, reject) => {
        reservation.once('error', reject);
        reservation.once('listening', () => {
          const address = reservation.address();
          if (typeof address === 'object' && address) {
            resolve(address.port);
            return;
          }
          reject(new Error('Unable to allocate an ephemeral port'));
        });
        reservation.listen(0, host);
      });
      reservations.push(reservation);

      if (excludedPorts.has(port)) {
        continue;
      }

      // The live reservation proves the requested family is available. Probe
      // the other loopback family with the same connect + bind checks used by
      // isPortAvailable before releasing the candidate.
      if (!(await isPortAvailableOnComplementaryHost(port, host))) {
        continue;
      }

      return port;
    }
  } finally {
    await Promise.all(
      reservations.map(
        (reservation) => new Promise<void>((resolve) => reservation.close(() => resolve()))
      )
    );
  }

  throw new Error('Unable to allocate an unexcluded ephemeral port');
}
