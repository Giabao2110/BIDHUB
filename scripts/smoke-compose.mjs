import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:8080';
async function get(path) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, path);
  return response;
}
assert.match(await (await get('/')).text(), /BIDHUB/);
assert.match(await (await get('/auctions/test-nested-route')).text(), /BIDHUB/);
assert.equal((await (await get('/api/v1/health/live')).json()).status, 'ok');
assert.equal((await (await get('/api/v1/health/ready')).json()).status, 'ready');
for (const transport of ['polling', 'websocket']) {
  const client = io(origin, { transports: [transport], extraHeaders: { Origin: origin }, reconnection: false });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${transport} handshake timeout`)), 5000);
      client.once('connect', () => { clearTimeout(timer); resolve(); });
      client.once('connect_error', error => { clearTimeout(timer); reject(error); });
    });
    const ack = await client.timeout(3000).emitWithAck('auction:join', { auctionId: 'invalid' });
    assert.equal(ack.code, 'INVALID_AUCTION_ID');
  } finally { client.disconnect(); }
}
const denied = io(origin, { transports: ['websocket'], extraHeaders: { Origin: 'https://untrusted.example' }, reconnection: false });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Origin rejection timeout')), 5000);
    denied.once('connect', () => { clearTimeout(timer); reject(new Error('Unexpected allowed origin')); });
    denied.once('connect_error', () => { clearTimeout(timer); resolve(); });
  });
} finally { denied.disconnect(); }
console.log('Compose smoke passed: SPA routes, live/ready, polling, WebSocket, rejected Origin');
