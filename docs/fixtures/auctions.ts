/** BH-02-A mock responses. Fixed clock; never import as a production seed. */
import type { AuctionSnapshot, AuctionStatus, BidAccepted, ApiError } from '../../packages/contracts/src/index.js';

export const serverTime = '2026-10-14T03:00:00.000Z';
export const seller = { id: '10000000-0000-4000-8000-000000000001', displayName: 'Demo Seller' };
export const buyer = { id: '10000000-0000-4000-8000-000000000002', displayName: 'Demo Buyer' };
export const category = { id: '20000000-0000-4000-8000-000000000001', name: 'Electronics' };

function detail(id: string, status: AuctionStatus, title: string, currentPriceVnd: string, endsAt: string, version: number) {
  return {
    auction: { id, title, status, currentPriceVnd, minimumIncrementVnd: '10000', endsAt, serverTime, version } satisfies AuctionSnapshot,
    description: 'Synthetic demonstration item; no real user data.',
    imageUrl: null,
    seller,
    category,
  };
}

export const scenarios = [
  {
    name: 'draft-owner', audience: 'owner',
    openingPriceVnd: '100000', startsAt: '2026-10-15T03:00:00.000Z',
    response: detail('30000000-0000-4000-8000-000000000001', 'DRAFT', 'Draft headphones', '100000', '2026-10-15T04:00:00.000Z', 0),
    history: [], result: null,
  },
  {
    name: 'scheduled', audience: 'public',
    openingPriceVnd: '100000', startsAt: '2026-10-14T04:00:00.000Z',
    response: detail('30000000-0000-4000-8000-000000000002', 'SCHEDULED', 'Scheduled keyboard', '100000', '2026-10-14T05:00:00.000Z', 1),
    history: [], result: null,
  },
  {
    name: 'active', audience: 'public',
    openingPriceVnd: '100000', startsAt: '2026-10-14T02:00:00.000Z',
    response: detail('30000000-0000-4000-8000-000000000003', 'ACTIVE', 'Active monitor', '110000', '2026-10-14T03:30:00.000Z', 2),
    history: [{ id: '40000000-0000-4000-8000-000000000001', amountVnd: '110000', bidderDisplayName: buyer.displayName, createdAt: '2026-10-14T02:30:00.000Z' }],
    result: null,
  },
  {
    name: 'ended-winner', audience: 'public',
    openingPriceVnd: '100000', startsAt: '2026-10-14T00:00:00.000Z',
    response: detail('30000000-0000-4000-8000-000000000004', 'ENDED', 'Ended speaker', '120000', '2026-10-14T01:00:00.000Z', 3),
    history: [{ id: '40000000-0000-4000-8000-000000000002', amountVnd: '120000', bidderDisplayName: buyer.displayName, createdAt: '2026-10-14T00:30:00.000Z' }],
    result: { auctionId: '30000000-0000-4000-8000-000000000004', winner: buyer, finalPriceVnd: '120000', closedAt: '2026-10-14T01:00:02.000Z' },
  },
  {
    name: 'cancelled-after-publish', audience: 'public-proposal',
    openingPriceVnd: '100000', startsAt: '2026-10-14T01:00:00.000Z',
    response: detail('30000000-0000-4000-8000-000000000005', 'CANCELLED', 'Cancelled mouse', '100000', '2026-10-14T04:00:00.000Z', 2),
    history: [], result: null,
  },
  {
    name: 'ended-no-bids', audience: 'public',
    openingPriceVnd: '100000', startsAt: '2026-10-13T00:00:00.000Z',
    response: detail('30000000-0000-4000-8000-000000000006', 'ENDED', 'Unsold webcam', '100000', '2026-10-13T01:00:00.000Z', 2),
    history: [],
    result: { auctionId: '30000000-0000-4000-8000-000000000006', winner: null, finalPriceVnd: null, closedAt: '2026-10-13T01:00:02.000Z' },
  },
] as const;

export const acceptedBid = {
  auction: { ...scenarios[2].response.auction, serverTime: '2026-10-14T02:30:00.000Z' },
  bidId: scenarios[2].history[0].id,
} satisfies BidAccepted;

export const bidTooLow = {
  error: { code: 'BID_TOO_LOW', message: 'Bid must meet the minimum amount.', requestId: '50000000-0000-4000-8000-000000000001' },
} satisfies ApiError;
