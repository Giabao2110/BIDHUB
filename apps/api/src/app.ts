import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { pool } from './database/pool.js';
import { log } from './observability/logger.js';
import { categoriesRouter } from './modules/categories/routes.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.webOrigin }));
app.use((req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader('X-Request-Id', res.locals.requestId);
  const started = performance.now();
  res.on('finish', () => log('http_request', {
    requestId: res.locals.requestId, method: req.method,
    // Route template avoids leaking query strings, tokens and user-provided paths.
    route: req.route?.path ?? 'unmatched', status: res.statusCode,
    durationMs: Math.round(performance.now() - started),
  }));
  next();
});
app.use(express.json({ limit: '64kb' }));
app.get('/api/v1/health/live', (_req, res) => res.json({ status: 'ok', service: 'bidhub-api' }));
app.get('/api/v1/health/ready', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ready' }); }
  catch { res.status(503).json({ status: 'not_ready' }); }
});
app.use('/api/v1/categories', categoriesRouter(pool));
app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: res.locals.requestId } }));
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const badJson = err instanceof SyntaxError && 'status' in err && err.status === 400;
  const tooLarge = typeof err === 'object' && err !== null && 'status' in err && err.status === 413;
  res.status(tooLarge ? 413 : badJson ? 400 : 500).json({ error: { code: tooLarge ? 'PAYLOAD_TOO_LARGE' : badJson ? 'INVALID_JSON' : 'INTERNAL_ERROR', message: tooLarge ? 'Request body too large' : badJson ? 'Invalid JSON body' : 'Unexpected server error', requestId: res.locals.requestId ?? randomUUID() } });
});
