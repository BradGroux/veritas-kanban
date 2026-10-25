import { createServer, request as httpRequest } from 'node:http';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

function fixture() {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 } });
  app.post('/upload', upload.array('files', 20), (req, res) => {
    res.json(
      (req.files as Express.Multer.File[]).map((file) => ({
        name: file.originalname,
        text: file.buffer.toString('utf8'),
        size: file.size,
      }))
    );
  });
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(400).json({ code: error.code });
  };
  app.use(onError);
  return app;
}

describe('in-memory multipart upload compatibility', () => {
  it('preserves multiple files and decodes browser-escaped filenames', async () => {
    const response = await request(fixture())
      .post('/upload')
      .attach('files', Buffer.from('first'), 'first.txt')
      .attach('files', Buffer.from('second'), 'a%22b.txt');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { name: 'first.txt', text: 'first', size: 5 },
      { name: 'a"b.txt', text: 'second', size: 6 },
    ]);
  });

  it('rejects an oversized file before the upload handler', async () => {
    const response = await request(fixture())
      .post('/upload')
      .attach('files', Buffer.alloc(17), 'large.txt');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'LIMIT_FILE_SIZE' });
  });

  it('rejects the twenty-first file before the upload handler', async () => {
    let upload = request(fixture()).post('/upload');
    for (let index = 0; index < 21; index++) {
      upload = upload.attach('files', Buffer.from('x'), `${index}.txt`);
    }
    const response = await upload;
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'LIMIT_UNEXPECTED_FILE' });
  });

  it('cleans a completed in-memory file after the client aborts the next file', async () => {
    const storage = multer.memoryStorage();
    const completed = Promise.withResolvers<void>();
    const cleaned = Promise.withResolvers<Express.Multer.File>();
    const handle = storage._handleFile.bind(storage);
    const remove = storage._removeFile.bind(storage);
    storage._handleFile = (req, file, callback) => {
      handle(req, file, (error, info) => {
        callback(error, info);
        if (!error) completed.resolve();
      });
    };
    storage._removeFile = (req, file, callback) => {
      remove(req, file, (error) => {
        callback(error);
        if (error) cleaned.reject(error);
        else cleaned.resolve(file);
      });
    };
    const app = express();
    app.post('/upload', multer({ storage }).array('files', 20), (_req, res) => res.end());
    const onError: ErrorRequestHandler = (_error, _req, res, _next) => res.end();
    app.use(onError);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const client = httpRequest({
      host: '127.0.0.1',
      port: address.port,
      path: '/upload',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=owned-upload',
        'Content-Length': '10000',
      },
    });
    client.on('error', () => {});
    try {
      client.write(
        '--owned-upload\r\nContent-Disposition: form-data; name="files"; filename="first.txt"\r\n\r\nfirst\r\n' +
          '--owned-upload\r\nContent-Disposition: form-data; name="files"; filename="second.txt"\r\n\r\npartial'
      );
      await completed.promise;
      client.destroy();
      const file = await cleaned.promise;
      expect(file.originalname).toBe('first.txt');
      expect(file.buffer).toBeUndefined();
    } finally {
      client.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
