import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createMetrics, metricsServer } from './metrics.js';
test('HTTP metrics use route templates, internal listener is isolated, lifecycle failures counted', async () => {
  const metrics = createMetrics();
  metrics.registerRuntime(() => ({total: 3, idle: 2, waiting: 1, sockets: 4}));
  const app = express();
  app.use(metrics.middleware);
  app.get('/auctions/:id', (_req, res) => res.sendStatus(200));
  const publicServer = createServer(app);
  const internal = metricsServer(metrics.registry);
  await Promise.all([new Promise<void>(r => publicServer.listen(0,'127.0.0.1',r)), new Promise<void>(r => internal.listen(0,'127.0.0.1',r))]);
  const a = publicServer.address(), b = internal.address();
  assert.ok(a && typeof a !== 'string' && b && typeof b !== 'string');
  const publicUrl = `http://127.0.0.1:${a.port}`, internalUrl = `http://127.0.0.1:${b.port}`;
  try {
    await (await fetch(publicUrl+'/auctions/private-id?token=secret-value')).text();
    await (await fetch(publicUrl+'/unmatched-secret-id')).text();
    assert.equal((await fetch(publicUrl+'/metrics')).status,404);
    assert.equal((await fetch(internalUrl+'/not-metrics')).status,404);
    await metrics.runLifecycle(async () => 2);
    await assert.rejects(metrics.runLifecycle(async () => { throw new Error('DB unavailable'); }));
    const response = await fetch(internalUrl+'/metrics');
    assert.equal(response.status,200);
    const text = await response.text();
    assert.match(text,/route="\/auctions\/:id"/);
    assert.doesNotMatch(text,/private-id|secret-value|unmatched-secret-id/);
    assert.match(text,/bidhub_lifecycle_runs_total\{result="failure"\} 1/);
    assert.match(text,/bidhub_lifecycle_transitions_total 2/);
    assert.match(text,/bidhub_socket_connections 4/);
    assert.match(text,/bidhub_db_pool_connections\{state="waiting"\} 1/);
  } finally {
    await Promise.all([new Promise<void>(r=>publicServer.close(()=>r())),new Promise<void>(r=>internal.close(()=>r()))]);
    metrics.registry.clear();
  }
});
