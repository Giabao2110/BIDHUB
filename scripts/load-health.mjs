// Read-only baseline. This measures HTTP liveness throughput, NOT bid contention.
const url = new URL(process.env.LOAD_URL ?? 'http://127.0.0.1:3000/api/v1/health/live');
const clients = Number(process.env.LOAD_CLIENTS ?? 10);
const requests = Number(process.env.LOAD_REQUESTS ?? 100);
if (!Number.isInteger(clients) || clients < 1 || clients > 100 || !Number.isInteger(requests) || requests < 1 || requests > 10000) throw new Error('Invalid load limits');
let next = 0, errors = 0;
const durations = [];
const started = performance.now();
await Promise.all(Array.from({length: clients}, async () => {
  while (next++ < requests) {
    const start = performance.now();
    try { const response = await fetch(url, {signal: AbortSignal.timeout(5000)}); await response.arrayBuffer(); if (!response.ok) errors++; }
    catch { errors++; }
    durations.push(performance.now() - start);
  }
}));
durations.sort((a,b) => a-b);
console.log(JSON.stringify({ metric: 'HTTP liveness baseline', time: new Date().toISOString(), target: url.origin + url.pathname, clients, requests, errors, errorRate: errors/requests, p95Ms: durations[Math.ceil(durations.length*.95)-1], durationMs: performance.now()-started }, null, 2));
