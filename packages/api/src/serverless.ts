/**
 * Serverless-friendly entrypoint for the HyperDX API.
 *
 * This module exposes the existing Express application from `./api-app` as a
 * stateless `(req, res) => Promise<void>` handler suitable for Vercel
 * serverless functions or any other platform that hands off Node.js
 * IncomingMessage / ServerResponse objects.
 *
 * Differences vs `./server.ts`:
 *   - Does NOT call `app.listen()` or set up graceful shutdown — the platform
 *     manages the lifecycle.
 *   - Lazily opens SQLite on the first invocation. The initialization promise
 *     is cached for warm invocations and reset on failure.
 *   - Optionally strips a URL prefix (default `/api`) from `req.url` before
 *     dispatching, so the catch-all Next.js route `/api/[...all]` lines up
 *     with Express routes mounted at `/me`, `/dashboards`, etc.
 *
 * This file MUST NOT import scheduled task runners (`./tasks/...`) or invoke
 * any code that spawns long-lived timers/intervals — Vercel functions are
 * killed shortly after the response is sent.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { serializeError } from 'serialize-error';

import app from './api-app';
import * as config from './config';
import { closeDb, openDb } from './db';
import { migrate } from './db/migrate';
import logger from './utils/logger';

// Guard against misconfigured Vercel previews. The serverless entrypoint only
// supports the `api` app type — OPAMP runs as its own long-lived server and
// has no place in a stateless preview function.
if (config.APP_TYPE !== 'api') {
  throw new Error(
    `Serverless API entrypoint requires APP_TYPE=api (received: ${config.APP_TYPE}). OPAMP and other app types are not supported in preview deployments.`,
  );
}

const DEFAULT_STRIP_PREFIX = '/api';

const stripPrefix =
  process.env.HDX_INLINE_API_STRIP_PREFIX ?? DEFAULT_STRIP_PREFIX;

let dbReady: Promise<void> | null = null;

// The platform owns shutdown, but a normal worker exit still closes its handle.
process.once('exit', () => closeDb());

function ensureDb(): Promise<void> {
  if (dbReady == null) {
    dbReady = Promise.resolve()
      .then(async () => {
        openDb();
        migrate();
      })
      .catch(err => {
        // Reset the cache so the next invocation re-attempts the connection
        // rather than permanently rejecting with a stale error.
        dbReady = null;
        logger.error(
          { err: serializeError(err) },
          'Serverless API failed to open SQLite',
        );
        throw err;
      });
  }
  return dbReady;
}

function rewriteUrl(req: IncomingMessage): void {
  if (!stripPrefix || !req.url) return;
  if (req.url === stripPrefix) {
    req.url = '/';
    return;
  }
  if (req.url.startsWith(`${stripPrefix}/`)) {
    req.url = req.url.slice(stripPrefix.length);
  }
}

export async function serverlessHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await ensureDb();
  } catch {
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Database unavailable' }));
    }
    return;
  }
  rewriteUrl(req);
  // Delegate to the Express application. Express itself handles errors via
  // the error-handling middleware registered in api-app.ts.
  return app(req, res);
}

export default serverlessHandler;
