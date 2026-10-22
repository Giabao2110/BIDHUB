import type { Server } from 'socket.io';
import { auctionRoom } from './auction-rooms.js';
export interface PublicAuctionSnapshot {
  id: string; title: string; status: string; currentPriceVnd: string;
  minimumIncrementVnd: string; endsAt: string; serverTime: string; version: number;
}
export function createAuctionPublisher(io: Server) {
  return (auction: PublicAuctionSnapshot) => {
    // Explicit projection: do not expose extra fields passed by a DB service.
    const { id, title, status, currentPriceVnd, minimumIncrementVnd, endsAt, serverTime, version } = auction;
    io.to(auctionRoom(id)).emit('auction:updated', { auction: { id, title, status, currentPriceVnd, minimumIncrementVnd, endsAt, serverTime, version } });
  };
}
