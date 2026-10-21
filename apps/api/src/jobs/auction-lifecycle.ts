import type { Pool } from 'pg';
import type { PublicAuctionSnapshot } from '../realtime/publisher.js';
import { withTransaction } from '../realtime/after-commit.js';
import { log } from '../observability/logger.js';

/** One bounded batch; row locks serialize lifecycle with bid/cancel transactions. */
export async function processAuctionLifecycle(db: Pool, publish: (snapshot: PublicAuctionSnapshot) => void): Promise<number> {
  return withTransaction(db, async (client, afterCommit) => {
    const due = await client.query(`SELECT * FROM auctions
      WHERE (status='SCHEDULED' AND starts_at <= clock_timestamp())
         OR (status='ACTIVE' AND ends_at <= clock_timestamp())
      ORDER BY ends_at, id LIMIT 100 FOR UPDATE SKIP LOCKED`);
    for (const auction of due.rows) {
      // Read wall clock after locking; CURRENT_TIMESTAMP would be transaction-start time.
      const clock = await client.query('SELECT clock_timestamp() AS now');
      const now: Date = clock.rows[0].now;
      const ended = new Date(auction.ends_at) <= now;
      if (ended) {
        const winner = await client.query(`SELECT id, bidder_id, amount_vnd FROM bids
          WHERE auction_id=$1 ORDER BY amount_vnd DESC, created_at ASC, id ASC LIMIT 1`, [auction.id]);
        const bid = winner.rows[0];
        await client.query(`INSERT INTO auction_results(auction_id,winner_id,winning_bid_id,final_price_vnd,closed_at)
          VALUES($1,$2,$3,$4,$5)`, [auction.id, bid?.bidder_id ?? null, bid?.id ?? null, bid?.amount_vnd ?? null, now]);
      }
      const updated = await client.query(`UPDATE auctions SET status=$2, version=version+1
        WHERE id=$1 RETURNING *`, [auction.id, ended ? 'ENDED' : 'ACTIVE']);
      const row = updated.rows[0];
      const snapshot: PublicAuctionSnapshot = {
        id: row.id, title: row.title, status: row.status,
        currentPriceVnd: String(row.current_price_vnd), minimumIncrementVnd: String(row.minimum_increment_vnd),
        endsAt: new Date(row.ends_at).toISOString(), serverTime: now.toISOString(), version: row.version,
      };
      afterCommit(() => publish(snapshot));
    }
    return due.rowCount ?? 0;
  });
}

/** Immediate catch-up on startup, then sequential ticks. Stop waits for current DB work. */
export function startAuctionLifecycle(work: () => Promise<number>, intervalMs = 3000) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = () => {
    running = (async () => {
      try { const count = await work(); if (count) log('auction_lifecycle_batch', { count }); }
      catch { log('auction_lifecycle_failed'); }
      if (!stopped) { timer = setTimeout(tick, intervalMs); timer.unref(); }
    })();
  };
  tick();
  return async () => { stopped = true; if (timer) clearTimeout(timer); await running; };
}
