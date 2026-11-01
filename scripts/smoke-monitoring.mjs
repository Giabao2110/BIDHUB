import assert from 'node:assert/strict';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:8080';
const prometheus = process.env.PROMETHEUS_URL ?? 'http://127.0.0.1:9090';
const grafana = process.env.GRAFANA_URL ?? 'http://127.0.0.1:3001';
await (await fetch(origin+'/api/v1/health/live')).text();
// Proxied app must not expose internal metrics (SPA fallback is permitted).
const external = await (await fetch(origin+'/metrics')).text();
assert.ok(!external.includes('bidhub_http_duration_seconds_bucket'));
const deadline = Date.now() + 60000;
let verified = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(prometheus+'/api/v1/query?query='+encodeURIComponent('up{job="bidhub-api"}'), {signal:AbortSignal.timeout(3000)});
    const json = await response.json();
    if (json.data?.result?.some(item => item.value[1] === '1')) { verified = true; break; }
  } catch {}
  await new Promise(r => setTimeout(r,1000));
}
assert.ok(verified,'Prometheus must scrape API successfully');
const metrics = await (await fetch(prometheus+'/api/v1/query?query='+encodeURIComponent('bidhub_db_pool_connections'))).json();
assert.ok(metrics.data.result.length >= 3,'DB pool series present');
const rules = await (await fetch(prometheus+'/api/v1/rules')).json();
assert.ok(rules.data.groups.some(g=>g.rules.some(r=>r.name==='BidHubLifecycleFailing')));
const auth = 'Basic '+Buffer.from('admin:'+process.env.GRAFANA_PASSWORD).toString('base64');
let dashboard;
while (Date.now() < deadline) {
  try {
    const response = await fetch(grafana+'/api/dashboards/uid/bidhub-operations',{headers:{Authorization:auth},signal:AbortSignal.timeout(3000)});
    if(response.ok) { dashboard = await response.json(); break; }
  } catch {}
  await new Promise(r=>setTimeout(r,1000));
}
assert.equal(dashboard?.dashboard?.panels?.length,8,'Provisioned dashboard contains 8 panels');
console.log('Monitoring smoke passed: private metrics, Prometheus target/pool series, alert rules, Grafana dashboard');
