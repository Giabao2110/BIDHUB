import { Router } from 'express';
import type { Pool } from 'pg';
import { HttpProblem } from '../../http/error.js';
import type { PublicAuctionSnapshot } from '../../realtime/publisher.js';
import { auctionUuid, pagination } from '../auctions/list-query.js';
import { findAuction, publicAuctionExists } from '../auctions/read.js';
import type { BrowserSession } from '../auth/browser-session.js';
import type { SessionUser } from '../auth/sessions.js';
import { BidError, placeBid } from './bid-service.js';

const problems = {
  UNAUTHENTICATED: [401, 'Sign in to place a bid'],
  ACCOUNT_DISABLED: [403, 'Account is disabled'],
  SELF_BIDDING: [403, 'The seller cannot bid on this auction'],
  NOT_FOUND: [404, 'Auction not found'],
  AUCTION_NOT_ACTIVE: [409, 'This auction is not accepting bids'],
  BID_TOO_LOW: [409, 'The amount does not meet the current minimum'],
  IDEMPOTENCY_CONFLICT: [409, 'This request key was already used with different bid details'],
  INVALID_INPUT: [422, 'Provide a valid request key and VND amount'],
} as const satisfies Record<BidError['code'], readonly [number, string]>;

const notFound = () => new HttpProblem(404, 'NOT_FOUND', 'Auction not found');
function auctionId(id: unknown) {
  if (typeof id !== 'string' || !auctionUuid.test(id)) throw notFound();
  return id;
}

export function bidsRouter(db: Pool, browser: BrowserSession, publish: (auction: PublicAuctionSnapshot) => void) {
  const router = Router();
  const windowMs = 10_000;
  const attempts = new Map<string, number>();
  let resetAt = 0;

  router.post('/:id/bids', browser.requireUser, browser.requireCsrf, async (req, res) => {
    const id = auctionId(req.params.id);
    const bidderId = (res.locals.user as SessionUser).id;
    const now = Date.now();
    if (now >= resetAt) {
      attempts.clear();
      resetAt = now + windowMs;
    }
    const count = attempts.get(bidderId) ?? 0;
    if (count >= 30 || (!attempts.has(bidderId) && attempts.size >= 10_000)) {
      res.set('Retry-After', String(Math.ceil((resetAt - now) / 1000)));
      throw new HttpProblem(429, 'RATE_LIMITED', 'Too many bid attempts; retry with the same request key');
    }
    attempts.set(bidderId, count + 1);

    if (!await publicAuctionExists(db, id)) throw notFound();
    try {
      const { auction, bidId, replayed } = await placeBid(db, {
        bidderId, auctionId: id, idempotencyKey: req.get('Idempotency-Key'), amountVnd: req.body?.amountVnd,
      }, publish);
      res.status(replayed ? 200 : 201).json({ auction, bidId });
    } catch (error) {
      if (!(error instanceof BidError)) throw error;
      const [status, message] = problems[error.code];
      throw new HttpProblem(status, error.code, message);
    }
  });

  router.get('/:id/bids', async (req, res) => {
    const id = auctionId(req.params.id);
    const { page, pageSize } = pagination(req.query);
    if (!await publicAuctionExists(db, id)) throw notFound();
    const { rows } = await db.query<{ id: string | null; total: string; amountVnd: string; bidderDisplayName: string; createdAt: Date }>(`
      SELECT totals.total, b.id, b.amount_vnd::text AS "amountVnd", u.display_name AS "bidderDisplayName", b.created_at AS "createdAt"
      FROM (SELECT count(*) AS total FROM bids WHERE auction_id=$1) totals
      LEFT JOIN LATERAL (SELECT * FROM bids WHERE auction_id=$1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3) b ON true
      LEFT JOIN users u ON u.id=b.bidder_id ORDER BY b.created_at DESC, b.id`, [id, pageSize, (page - 1) * pageSize]);
    res.json({ items: rows.filter(row => row.id !== null).map(({ total: _total, ...item }) => item), total: Number(rows[0]?.total ?? 0), page, pageSize });
  });

  router.get('/:id/result', async (req, res) => {
    const id = auctionId(req.params.id);
    const detail = await findAuction(db, id, null);
    if (!detail) throw notFound();
    if (detail.auction.status === 'CANCELLED') throw new HttpProblem(409, 'AUCTION_CANCELLED', 'This auction was cancelled');
    if (detail.auction.status !== 'ENDED') throw new HttpProblem(409, 'RESULT_NOT_READY', 'The auction has not closed');
    const { rows: [result] } = await db.query<{ winner_id: string | null; display_name: string; final_price: string | null; closed_at: Date }>(`
      SELECT r.winner_id, u.display_name, r.final_price_vnd::text AS final_price, r.closed_at
      FROM auction_results r LEFT JOIN users u ON u.id=r.winner_id WHERE r.auction_id=$1`, [id]);
    if (!result) throw new HttpProblem(409, 'RESULT_NOT_READY', 'The auction result is not available');
    res.json({ auctionId: detail.auction.id, winner: result.winner_id ? { id: result.winner_id, displayName: result.display_name } : null,
      finalPriceVnd: result.final_price, closedAt: result.closed_at });
  });

  return router;
}

export function myBidsRouter(db: Pool, browser: BrowserSession) {
  const router = Router();
  router.get('/', browser.requireUser, async (req, res) => {
    const { page, pageSize } = pagination(req.query);
    const bidderId = (res.locals.user as SessionUser).id;
    const { rows } = await db.query(`
      SELECT totals.total, b.id, b.amount_vnd::text AS "amountVnd", b.created_at AS "createdAt",
        a.id AS "auctionId", a.title AS "auctionTitle", a.status AS "auctionStatus"
      FROM (SELECT count(*) AS total FROM bids WHERE bidder_id=$1) totals
      LEFT JOIN LATERAL (SELECT * FROM bids WHERE bidder_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3) b ON true
      LEFT JOIN auctions a ON a.id=b.auction_id ORDER BY b.created_at DESC,b.id`, [bidderId, pageSize, (page - 1) * pageSize]);
    res.json({ items: rows.filter(row => row.id !== null).map(({ total: _total, ...item }) => item), total: Number(rows[0]?.total ?? 0), page, pageSize });
  });
  return router;
}
