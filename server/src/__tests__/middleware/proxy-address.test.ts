import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';

describe('Express proxy address trust', () => {
  let app: ReturnType<typeof express>;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    app = express();
    app.get('/', (req, res) => res.json({ ip: req.ip, remote: req.socket.remoteAddress }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it('keeps an IPv4 peer outside a native IPv6 trust range', async () => {
    app.set('trust proxy', '::/1');
    const response = await request(server).get('/').set('X-Forwarded-For', '198.51.100.42');
    expect(response.status).toBe(200);
    expect(response.body.ip).toBe(response.body.remote);
    expect(response.body.ip).not.toBe('198.51.100.42');
  });

  it('preserves an explicitly trusted loopback proxy', async () => {
    app.set('trust proxy', 'loopback');
    const response = await request(server).get('/').set('X-Forwarded-For', '198.51.100.42');
    expect(response.status).toBe(200);
    expect(response.body.ip).toBe('198.51.100.42');
  });
});
