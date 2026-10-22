import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { registerAuctionRooms, auctionRoom } from './auction-rooms.js';
test('real socket joins public auction, rejects drafts/invalid IDs and enforces room limit', async () => {
  const http = createServer();
  const io = new Server(http);
  registerAuctionRooms(io, async id => !id.endsWith('000000000099'));
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  assert.ok(address && typeof address !== 'string');
  const client = connect(`http://127.0.0.1:${address.port}`, { transports: ['websocket'] });
  try {
    await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    const join = (id: string) => client.timeout(2000).emitWithAck('auction:join', { auctionId: id });
    assert.equal((await join('bad')).code, 'INVALID_AUCTION_ID');
    assert.equal((await join('00000000-0000-4000-8000-000000000099')).code, 'NOT_FOUND');
    for (let i = 1; i <= 5; i++) assert.equal((await join(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)).ok, true);
    assert.equal((await join('00000000-0000-4000-8000-000000000006')).code, 'ROOM_LIMIT');
    const received = new Promise(resolve => client.once('auction:updated', resolve));
    io.to(auctionRoom('00000000-0000-4000-8000-000000000001')).emit('auction:updated', { auction: { version: 2 } });
    assert.deepEqual(await received, { auction: { version: 2 } });
    // Reconnect creates a new socket: old room membership must not survive.
    client.disconnect();
    const reconnected = new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    client.connect();
    await reconnected;
    assert.equal(io.sockets.sockets.get(client.id!)?.rooms.has(auctionRoom('00000000-0000-4000-8000-000000000001')), false);
    assert.equal((await join('00000000-0000-4000-8000-000000000001')).ok, true);
    const afterReconnect = new Promise(resolve => client.once('auction:updated', resolve));
    io.to(auctionRoom('00000000-0000-4000-8000-000000000001')).emit('auction:updated', { auction: { version: 3 } });
    assert.deepEqual(await afterReconnect, { auction: { version: 3 } });
  } finally { client.disconnect(); await new Promise<void>(resolve => io.close(() => resolve())); }
});
