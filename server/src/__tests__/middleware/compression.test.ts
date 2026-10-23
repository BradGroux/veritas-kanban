import { createServer, get } from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import compression from 'compression';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const body = 'Disposable response content. '.repeat(200);

describe('response compression compatibility', () => {
  let app: ReturnType<typeof express>;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    app = express();
    app.use(compression({ level: 6, threshold: 1024 }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    vi.restoreAllMocks();
  });

  it('preserves ordinary gzip response contents', async () => {
    app.get('/', (_req, res) => res.type('text').send(body));
    const response = await request(server).get('/').set('Accept-Encoding', 'gzip');
    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.text).toBe(body);
  });

  it.each(['no-transform', 'NO-TRANSFORM', 'public, No-Transform'])(
    'respects Cache-Control %s',
    async (policy) => {
      app.get('/', (_req, res) => res.set('Cache-Control', policy).type('text').send(body));
      const response = await request(server).get('/').set('Accept-Encoding', 'gzip');
      expect(response.status).toBe(200);
      expect(response.headers['content-encoding']).toBeUndefined();
      expect(response.text).toBe(body);
    }
  );

  it('releases the compression stream after an owned client disconnect', async () => {
    const createGzip = zlib.createGzip;
    let stream: ReturnType<typeof createGzip> | undefined;
    vi.spyOn(zlib, 'createGzip').mockImplementation((options) => {
      stream = createGzip(options);
      return stream;
    });
    app.get('/', (_req, res) => {
      res.type('text').write(body);
      res.flush();
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    await new Promise<void>((resolve, reject) => {
      const client = get(
        { host: '127.0.0.1', port: address.port, headers: { 'Accept-Encoding': 'gzip' } },
        (response) => {
          response.once('data', () => {
            response.destroy();
            client.destroy();
            resolve();
          });
        }
      );
      client.once('error', reject);
      client.setTimeout(1000, () => client.destroy(new Error('Fixture response timed out')));
    });
    await vi.waitFor(() => {
      expect(stream).toBeDefined();
      expect(stream?.destroyed).toBe(true);
      expect(stream?.closed).toBe(true);
    });
  });
});
