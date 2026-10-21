import type { Server } from 'socket.io';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function auctionRoom(id: string) { return `auction:${id}`; }
export function registerAuctionRooms(io: Server, isPublic: (id: string) => Promise<boolean>) {
  io.on('connection', socket => {
    // Serialize async joins so concurrent requests cannot evade the room cap.
    let queue = Promise.resolve();
    let windowStart = Date.now();
    let operations = 0;
    const allowed = () => {
      if (Date.now() - windowStart >= 10000) { windowStart = Date.now(); operations = 0; }
      return ++operations <= 20;
    };
    socket.on('auction:join', (payload: unknown, callback: unknown) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      if (!allowed()) { ack({ ok: false, code: 'RATE_LIMITED' }); return; }
      const id = typeof payload === 'object' && payload !== null && 'auctionId' in payload ? payload.auctionId : null;
      if (typeof id !== 'string' || !uuid.test(id)) { ack({ ok: false, code: 'INVALID_AUCTION_ID' }); return; }
      queue = queue.then(async () => {
        if (!socket.connected) return;
        const room = auctionRoom(id);
        if (!socket.rooms.has(room) && socket.rooms.size >= 6) { ack({ ok: false, code: 'ROOM_LIMIT' }); return; }
        try {
          if (!await isPublic(id)) { ack({ ok: false, code: 'NOT_FOUND' }); return; }
          if (!socket.connected) return;
          await socket.join(room);
          ack({ ok: true });
        } catch { ack({ ok: false, code: 'TEMPORARILY_UNAVAILABLE' }); }
      }).catch(() => {});
    });
    socket.on('auction:leave', (payload: unknown) => {
      if (!allowed()) return;
      const id = typeof payload === 'object' && payload !== null && 'auctionId' in payload ? payload.auctionId : null;
      if (typeof id === 'string' && uuid.test(id)) queue = queue.then(async () => { await socket.leave(auctionRoom(id)); }).catch(() => {});
    });
  });
}
