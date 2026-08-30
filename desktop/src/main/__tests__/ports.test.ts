import { describe, expect, it, vi } from 'vitest';
import net from 'node:net';

import { findAvailablePort, isPortAvailable } from '../ports.js';

async function listenOnEphemeralPort(server: net.Server, host: string): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, host);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error(`Unable to resolve ${host} test listener port`);
  }
  return address.port;
}

async function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function acquireAvailablePort(host = '127.0.0.1'): Promise<number> {
  const reservation = net.createServer();
  try {
    return await listenOnEphemeralPort(reservation, host);
  } finally {
    await closeServer(reservation);
  }
}

describe('port selection', () => {
  it('returns the preferred port when it is available', async () => {
    const preferredPort = await acquireAvailablePort();

    const port = await findAvailablePort(preferredPort, '127.0.0.1', 1);

    expect(port).toBe(preferredPort);
  });

  it('falls forward when the preferred port is busy', async () => {
    const server = net.createServer();
    const preferredPort = await listenOnEphemeralPort(server, '127.0.0.1');

    try {
      expect(await isPortAvailable(preferredPort)).toBe(false);

      const port = await findAvailablePort(preferredPort, '127.0.0.1', 1);

      expect(port).not.toBe(preferredPort);
      expect(await isPortAvailable(port)).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it('keeps separately selected desktop fallback ports distinct', async () => {
    const busyServer = net.createServer();
    const preferredPort = await listenOnEphemeralPort(busyServer, '127.0.0.1');

    try {
      const serverPort = await findAvailablePort(preferredPort, '127.0.0.1', 1);
      const webPort = await findAvailablePort(preferredPort, '127.0.0.1', 1, new Set([serverPort]));

      expect(serverPort).not.toBe(preferredPort);
      expect(webPort).not.toBe(preferredPort);
      expect(webPort).not.toBe(serverPort);
      expect(await isPortAvailable(serverPort)).toBe(true);
      expect(await isPortAvailable(webPort)).toBe(true);
    } finally {
      await closeServer(busyServer);
    }
  });

  it('falls forward when the preferred port is busy on an IPv6 wildcard', async () => {
    const server = net.createServer();
    let preferredPort: number;

    try {
      preferredPort = await listenOnEphemeralPort(server, '::');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EAFNOSUPPORT' || code === 'EADDRNOTAVAIL') {
        return;
      }
      throw error;
    }

    try {
      expect(await isPortAvailable(preferredPort)).toBe(false);

      const port = await findAvailablePort(preferredPort, '127.0.0.1', 1);

      expect(port).not.toBe(preferredPort);
      expect(await isPortAvailable(port)).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects IPv6-busy and excluded ephemeral fallback candidates', async () => {
    const ipv6Server = net.createServer();

    try {
      await new Promise<void>((resolve, reject) => {
        ipv6Server.once('error', reject);
        ipv6Server.listen(0, '::1', resolve);
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EAFNOSUPPORT' || code === 'EADDRNOTAVAIL') {
        return;
      }
      throw error;
    }

    const ipv6Address = ipv6Server.address();
    if (!ipv6Address || typeof ipv6Address === 'string') {
      throw new Error('Unable to resolve IPv6 test listener port');
    }

    const excludedServer = net.createServer();
    await new Promise<void>((resolve) => excludedServer.listen(0, '127.0.0.1', resolve));
    const excludedAddress = excludedServer.address();
    if (!excludedAddress || typeof excludedAddress === 'string') {
      throw new Error('Unable to resolve excluded test listener port');
    }
    await new Promise<void>((resolve) => excludedServer.close(() => resolve()));

    const originalListen = net.Server.prototype.listen;
    const forcedPorts = [ipv6Address.port, excludedAddress.port];
    const listenSpy = vi.spyOn(net.Server.prototype, 'listen').mockImplementation(function (
      this: net.Server,
      ...args: unknown[]
    ) {
      if (args[0] === 0 && args[1] === '127.0.0.1' && forcedPorts.length > 0) {
        return Reflect.apply(originalListen, this, [
          forcedPorts.shift(),
          '127.0.0.1',
        ]) as net.Server;
      }
      return Reflect.apply(originalListen, this, args) as net.Server;
    });

    try {
      const port = await findAvailablePort(47635, '127.0.0.1', 0, new Set([excludedAddress.port]));

      expect(forcedPorts).toHaveLength(0);
      expect(port).not.toBe(ipv6Address.port);
      expect(port).not.toBe(excludedAddress.port);
      expect(await isPortAvailable(port)).toBe(true);
    } finally {
      listenSpy.mockRestore();
      await new Promise<void>((resolve) => ipv6Server.close(() => resolve()));
    }
  });
});
