import type { PublicAuctionSnapshot } from '../../realtime/publisher.js';

export interface SnapshotRow {
  id: string;
  title: string;
  status: string;
  current_price_vnd: string;
  minimum_increment_vnd: string;
  ends_at: Date;
  version: number;
}

export function auctionSnapshot(row: SnapshotRow, now: Date): PublicAuctionSnapshot {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    currentPriceVnd: String(row.current_price_vnd),
    minimumIncrementVnd: String(row.minimum_increment_vnd),
    endsAt: new Date(row.ends_at).toISOString(),
    serverTime: now.toISOString(),
    version: row.version,
  };
}
