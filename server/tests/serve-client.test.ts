import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { serveClient, defaultClientDist } from '../src/shared/serve-client.js';
import { notFoundHandler } from '../src/middleware/not-found.js';
import { errorHandler } from '../src/middleware/error-handler.js';

describe('production SPA serving (Phase 11)', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  const app = express();
  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
  serveClient(app, dist);
  app.use(notFoundHandler);
  app.use(errorHandler);

  it('serves assets with long caching and SPA routes with index.html', async () => {
    const asset = await request(app).get('/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    for (const route of ['/', '/w/acme/tickets/4', '/o/acme/submit', '/invite']) {
      const page = await request(app).get(route);
      expect(page.status).toBe(200);
      expect(page.text).toContain('id="root"');
    }
  });

  it('never falls back for /api: unknown API routes stay JSON 404', async () => {
    expect((await request(app).get('/api/v1/health')).body).toEqual({ status: 'ok' });
    const missing = await request(app).get('/api/v1/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('points at client/dist next to the server folder', () => {
    expect(defaultClientDist().split(path.sep).slice(-2)).toEqual(['client', 'dist']);
  });
});
