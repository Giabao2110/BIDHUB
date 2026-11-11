import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:8080').origin;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage();
  await page.goto(origin, { timeout: 10_000 });
  // A real browser sets handshake headers. A Node client can inadvertently hide
  // failures by injecting an Origin header that same-origin polling does not send.
  const result = await page.evaluate(async () => {
    const { io } = await import('/socket.io/socket.io.esm.min.js');
    const results = [];
    for (const transport of ['polling', 'websocket']) {
      const client = io({ transports: [transport], reconnection: false, timeout: 5_000 });
      try {
        await new Promise((resolve, reject) => {
          client.once('connect', resolve);
          client.once('connect_error', error => reject(new Error(`${transport}: ${error.message}`)));
        });
        const ack = await client.timeout(3_000).emitWithAck('auction:join', { auctionId: 'invalid' });
        results.push({ transport: client.io.engine.transport.name, code: ack.code });
      } finally { client.disconnect(); }
    }
    return results;
  });
  assert.deepEqual(result, ['polling', 'websocket'].map(transport => ({ transport, code: 'INVALID_AUCTION_ID' })));
  console.log('Browser Socket.IO smoke passed: same-origin polling and WebSocket');
} finally { await browser.close(); }
