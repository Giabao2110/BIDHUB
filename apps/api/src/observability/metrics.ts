import { createServer } from 'node:http';
import type { RequestHandler } from 'express';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from '@prometheus-io/client';

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'bidhub_' });
  const http = new Histogram({ name: 'bidhub_http_duration_seconds', help: 'Completed API request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const, buckets: [.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5], registers: [registry] });
  const lifecycle = new Counter({ name: 'bidhub_lifecycle_runs_total', help: 'Lifecycle batches by result', labelNames: ['result'] as const, registers: [registry] });
  const changed = new Counter({ name: 'bidhub_lifecycle_transitions_total', help: 'Committed auction transitions', registers: [registry] });
  lifecycle.inc({ result: 'success' }, 0);
  lifecycle.inc({ result: 'failure' }, 0);
  changed.inc(0);
  const middleware: RequestHandler = (req, res, next) => {
    const started = performance.now();
    res.once('finish', () => {
      const method = ['GET','POST','PATCH','PUT','DELETE','OPTIONS','HEAD'].includes(req.method) ? req.method : 'OTHER';
      // Never use originalUrl, params, query, user IDs or token labels.
      const route = typeof req.route?.path === 'string' ? req.baseUrl + req.route.path : 'unmatched';
      http.observe({ method, route, status: String(res.statusCode) }, (performance.now() - started) / 1000);
    });
    next();
  };
  function registerRuntime(read: () => { total: number; idle: number; waiting: number; sockets: number }) {
    new Gauge({ name: 'bidhub_db_pool_connections', help: 'Database pool connections by state', labelNames: ['state'] as const, registers: [registry],
      collect() { const value = read(); this.set({state:'total'}, value.total); this.set({state:'idle'}, value.idle); this.set({state:'waiting'}, value.waiting); } });
    new Gauge({ name: 'bidhub_socket_connections', help: 'Current Socket.IO transport connections', registers: [registry],
      collect() { this.set(read().sockets); } });
  }
  async function runLifecycle(work: () => Promise<number>) {
    try { const count = await work(); lifecycle.inc({result:'success'}); changed.inc(count); return count; }
    catch (error) { lifecycle.inc({result:'failure'}); throw error; }
  }
  return { registry, middleware, registerRuntime, runLifecycle };
}

export const metrics = createMetrics();

/** Separate internal listener, never mounted on the public Express application. */
export function metricsServer(registry: Registry) {
  return createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') { res.writeHead(404).end(); return; }
    try { res.writeHead(200, { 'Content-Type': registry.contentType }); res.end(await registry.metrics()); }
    catch { res.writeHead(503).end(); }
  });
}
