import type { Pool } from 'pg';
import { withTransaction } from '../../realtime/after-commit.js';
import type { PublicAuctionSnapshot } from '../../realtime/publisher.js';
import { ANTI_SNIPING_EXTENSION_MS, ANTI_SNIPING_WINDOW_MS, validateBidRules } from './bid-policy.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AMOUNT_VND = 9_223_372_036_854_775_807n;

type BidErrorCode = NonNullable<ReturnType<typeof validateBidRules>>
  | 'UNAUTHENTICATED' | 'ACCOUNT_DISABLED' | 'NOT_FOUND' | 'IDEMPOTENCY_CONFLICT' | 'INVALID_INPUT';

export class BidError extends Error {
  constructor(readonly code: BidErrorCode) {
    super(code);
    this.name = 'BidError';
  }
}

export interface PlaceBidInput {
  bidderId: string; // The caller supplies the authenticated session user's ID.
  auctionId: unknown;
  idempotencyKey: unknown;
  amountVnd: unknown;
}

type AuctionStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
type BidSnapshot = PublicAuctionSnapshot & { status: AuctionStatus };

export interface PlaceBidResult {
  auction: BidSnapshot;
  bidId: string;
  replayed: boolean;
}

interface SnapshotRow {
  id: string;
  title: string;
  status: AuctionStatus;
  current_price_vnd: string;
  minimum_increment_vnd: string;
  ends_at: Date;
  version: number;
}

function toSnapshot(row: SnapshotRow, serverTime: Date): BidSnapshot {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    currentPriceVnd: row.current_price_vnd,
    minimumIncrementVnd: row.minimum_increment_vnd,
    endsAt: row.ends_at.toISOString(),
    serverTime: serverTime.toISOString(),
    version: row.version,
  };
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

function parseAmount(value: unknown): bigint {
  if (typeof value !== 'string' || /[^0-9]/.test(value)) throw new BidError('INVALID_INPUT');
  const digits = value.replace(/^0+/, '');
  if (!digits || digits.length > 19) throw new BidError('INVALID_INPUT');
  const amount = BigInt(digits);
  if (amount > MAX_AMOUNT_VND) throw new BidError('INVALID_INPUT');
  return amount;
}

/** Accept a bid or replay its ID with the current auction snapshot. */
export async function placeBid(
  db: Pool,
  input: PlaceBidInput,
  publish: (auction: PublicAuctionSnapshot) => void,
): Promise<PlaceBidResult> {
  if (!isUuid(input.bidderId)) throw new BidError('UNAUTHENTICATED');
  if (!isUuid(input.auctionId) || !isUuid(input.idempotencyKey)) throw new BidError('INVALID_INPUT');
  const amount = parseAmount(input.amountVnd);
  const amountVnd = amount.toString();
  const bidderId = input.bidderId.toLowerCase();
  const auctionId = input.auctionId.toLowerCase();
  const key = input.idempotencyKey;

  return withTransaction(db, async (client, afterCommit) => {
    // Lock bidder before auction. This orders writes for keys scoped to a bidder
    // even across auctions, and serializes with account disable. The scheduler's
    // foreign-key checks may still acquire KEY SHARE on a bidder.
    const { rows: [bidder] } = await client.query<{ disabled: boolean }>(
      'SELECT disabled_at IS NOT NULL AS disabled FROM users WHERE id=$1 FOR NO KEY UPDATE',
      [bidderId],
    );
    if (!bidder) throw new BidError('UNAUTHENTICATED');
    if (bidder.disabled) throw new BidError('ACCOUNT_DISABLED');

    const { rows: [previous] } = await client.query<{ id: string; auction_id: string; amount_vnd: string }>(
      'SELECT id, auction_id, amount_vnd::text FROM bids WHERE bidder_id=$1 AND idempotency_key=$2',
      [bidderId, key],
    );
    if (previous && (previous.auction_id !== auctionId || previous.amount_vnd !== amountVnd)) {
      throw new BidError('IDEMPOTENCY_CONFLICT');
    }

    const { rows: [auction] } = await client.query<SnapshotRow & { seller_id: string; opening_price_vnd: string }>(
      `SELECT id, title, status, seller_id, opening_price_vnd::text, current_price_vnd::text,
              minimum_increment_vnd::text, ends_at, version
       FROM auctions WHERE id=$1 FOR UPDATE`,
      [auctionId],
    );
    if (!auction) throw new BidError('NOT_FOUND');

    if (previous) {
      const { rows: [clock] } = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
      if (!clock) throw new Error('Could not read the database clock.');
      return { auction: toSnapshot(auction, clock.now), bidId: previous.id, replayed: true };
    }

    // Read one wall-clock value after obtaining the row lock. Keep eligibility
    // and extension calculations in PostgreSQL to preserve timestamp precision.
    const { rows: [clock] } = await client.query<{
      now: Date; bid_at: string; deadline: string; is_open: boolean; has_bids: boolean;
    }>(
      `WITH bid_clock AS MATERIALIZED (SELECT clock_timestamp() AS now)
       SELECT now, now::text AS bid_at, starts_at <= now AND now < ends_at AS is_open,
              (CASE WHEN ends_at - now <= $2::integer * interval '1 millisecond'
                THEN GREATEST(ends_at, now + $3::integer * interval '1 millisecond')
                ELSE ends_at END)::text AS deadline,
              EXISTS (SELECT 1 FROM bids WHERE auction_id=$1) AS has_bids
       FROM auctions CROSS JOIN bid_clock WHERE id=$1`,
      [auctionId, ANTI_SNIPING_WINDOW_MS, ANTI_SNIPING_EXTENSION_MS],
    );
    if (!clock) throw new Error('Could not read the locked auction state.');

    const rejection = validateBidRules({
      acceptsBids: auction.status === 'ACTIVE' && clock.is_open,
      sellerId: auction.seller_id,
      bidderId,
      openingPriceVnd: BigInt(auction.opening_price_vnd),
      currentPriceVnd: BigInt(auction.current_price_vnd),
      minimumIncrementVnd: BigInt(auction.minimum_increment_vnd),
      hasBids: clock.has_bids,
      amountVnd: amount,
    });
    if (rejection) throw new BidError(rejection);

    const { rows: [bid] } = await client.query<{ id: string }>(
      `INSERT INTO bids(auction_id, bidder_id, amount_vnd, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [auctionId, bidderId, amountVnd, key, clock.bid_at],
    );
    if (!bid) throw new Error('Bid insert did not return a row.');

    const { rows: [updated] } = await client.query<SnapshotRow>(
      `UPDATE auctions SET current_price_vnd=$2, highest_bidder_id=$3, ends_at=$4, version=version+1
       WHERE id=$1 RETURNING id, title, status, current_price_vnd::text,
         minimum_increment_vnd::text, ends_at, version`,
      [auctionId, amountVnd, bidderId, clock.deadline],
    );
    if (!updated) throw new Error('Auction update did not return a row.');

    const snapshot = toSnapshot(updated, clock.now);
    afterCommit(() => publish(snapshot));
    return { auction: snapshot, bidId: bid.id, replayed: false };
  });
}
