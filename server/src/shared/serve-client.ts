import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';

/**
 * Production only (D-08): Express serves the built React app, so browser and
 * API share one origin (first-party cookies, no CORS).
 *  - files from client/dist (hashed assets cached for a year)
 *  - any other non-/api GET returns index.html so React Router can handle it
 *  - /api/* never falls back: unknown API routes stay JSON 404s
 */
export const serveClient = (app: Express, distDir: string) => {
  const indexHtml = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`Client build not found at ${indexHtml}. Run "npm run build" in client/ first.`);
  }
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, file) => {
        res.setHeader(
          'Cache-Control',
          file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
        );
      },
    })
  );
  app.get(/^(?!\/api(\/|$)).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
};

/** client/dist relative to this file (works from src/ with tsx and from dist/ with node). */
export const defaultClientDist = () =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../client/dist');
