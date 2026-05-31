import { describe, expect, it } from 'vitest';
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
});
