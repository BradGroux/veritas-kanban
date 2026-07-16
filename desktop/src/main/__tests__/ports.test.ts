import { describe, expect, it, vi } from 'vitest';
import net from 'node:net';

import { findAvailablePort, isPortAvailable } from '../ports.js';

describe('port selection', () => {
  it('returns the preferred port when it is available', async () => {
    const port = await findAvailablePort(47631, '127.0.0.1', 1);
    expect(port).toBe(47631);
  });

  it('falls forward when the preferred port is busy', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(47632, '127.0.0.1', resolve));

    try {
      expect(await isPortAvailable(47632)).toBe(false);
      const port = await findAvailablePort(47632, '127.0.0.1', 3);
      expect(port).toBeGreaterThan(47632);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('keeps separately selected desktop fallback ports distinct', async () => {
    const busyServer = net.createServer();
    await new Promise<void>((resolve) => busyServer.listen(47633, '127.0.0.1', resolve));

    try {
      const serverPort = await findAvailablePort(47633, '127.0.0.1', 3);
      const webPort = await findAvailablePort(47633, '127.0.0.1', 3, new Set([serverPort]));

      expect(serverPort).toBeGreaterThan(47633);
      expect(webPort).toBeGreaterThan(47633);
      expect(webPort).not.toBe(serverPort);
    } finally {
      await new Promise<void>((resolve) => busyServer.close(() => resolve()));
    }
  });

  it('falls forward when the preferred port is busy on an IPv6 wildcard', async () => {
    const server = net.createServer();

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(47634, '::', resolve);
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EAFNOSUPPORT' || code === 'EADDRNOTAVAIL') {
        return;
      }
      throw error;
    }

    try {
      expect(await isPortAvailable(47634)).toBe(false);
      const port = await findAvailablePort(47634, '127.0.0.1', 3);
      expect(port).toBeGreaterThan(47634);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
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
