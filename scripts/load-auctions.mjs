// Read-only lab benchmark. Run in the disposable Compose API container.
const endpoint = new URL('http://127.0.0.1:3000/api/v1/auctions?page=1&pageSize=20');
const metricsUrl = 'http://127.0.0.1:9464/metrics';
const workers = 50;
const requests = 500;
const warmup = 20;

async function snapshot() {
  const response = await fetch(metricsUrl, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Metrics failed (${response.status})`);
  const lines = (await response.text()).split('\n');
  function metric(key) {
    const value = Number(lines.find(line => line.startsWith(`${key} `))?.split(' ')[1]);
    if (!Number.isFinite(value)) throw new Error(`Metric unavailable: ${key}`);
    return value;
  }
  return {
    cpuSeconds: metric('bidhub_process_cpu_seconds_total'),
    rssBytes: metric('bidhub_process_resident_memory_bytes'),
  };
}

async function readAuctions() {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
  if (response.status !== 200) {
    await response.arrayBuffer();
    return `HTTP ${response.status}`;
  }
  const data = await response.json();
  return data.page === 1 && data.pageSize === 20 && data.total >= 1 && Array.isArray(data.items) && data.items.length > 0
    ? 'ok' : 'invalid payload';
}

for (let i = 0; i < warmup; i++) {
  if (await readAuctions() !== 'ok') throw new Error('Warm-up did not return populated auction data');
}
const before = await snapshot();
const startedAt = new Date().toISOString();
const start = performance.now();
const outcomes = {};
const durations = [];
let next = 0;
await Promise.all(Array.from({ length: workers }, async () => {
  for (;;) {
    if (next++ >= requests) return;
    const from = performance.now();
    let result;
    try { result = await readAuctions(); } catch { result = 'transport or decoding error'; }
    outcomes[result] = (outcomes[result] ?? 0) + 1;
    if (result === 'ok') durations.push(performance.now() - from);
  }
}));
const durationMs = performance.now() - start;
const after = await snapshot();
durations.sort((a, b) => a - b);
const percentile = p => durations.length ? Number(durations[Math.ceil(durations.length * p) - 1].toFixed(2)) : null;
const p95Ms = percentile(0.95);
const errorRate = (requests - durations.length) / requests;
console.log(JSON.stringify({
  scope: 'CI loopback API, PostgreSQL list with demo data; bypasses Nginx throttling; not a production capacity test',
  commit: process.env.LAB_SHA ?? null,
  environment: { platform: process.platform, node: process.version, postgres: process.env.LAB_POSTGRES_VERSION ?? null },
  startedAt, workers, requests, warmup, outcomes, errorRate, p50Ms: percentile(0.5), p95Ms,
  durationMs: Number(durationMs.toFixed(2)),
  apiProcess: { cpuSecondsDelta: Number((after.cpuSeconds - before.cpuSeconds).toFixed(4)), rssBytesBefore: before.rssBytes, rssBytesAfter: after.rssBytes },
  labTarget: { p95MsBelow: 500, errorRateBelow: 0.01, met: p95Ms !== null && p95Ms < 500 && errorRate < 0.01 },
}, null, 2));
if (!durations.length) process.exitCode = 1;
