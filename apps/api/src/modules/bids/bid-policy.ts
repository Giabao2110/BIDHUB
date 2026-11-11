interface BidRulesInput {
  acceptsBids: boolean; sellerId: string; bidderId: string;
  currentPriceVnd: bigint; openingPriceVnd: bigint; minimumIncrementVnd: bigint;
  hasBids: boolean; amountVnd: bigint;
}

export interface BidPolicyInput extends Omit<BidRulesInput, 'acceptsBids'> {
  status: string; now: Date; endsAt: Date;
}

/** Pure policy; DB service must call this AFTER locking the auction row. */
export function validateBidRules(input: BidRulesInput) {
  if (!input.acceptsBids) return 'AUCTION_NOT_ACTIVE';
  if (input.sellerId === input.bidderId) return 'SELF_BIDDING';
  const minimum = input.hasBids ? input.currentPriceVnd + input.minimumIncrementVnd : input.openingPriceVnd;
  if (input.amountVnd < minimum) return 'BID_TOO_LOW';
  return null;
}

export function validateBid(input: BidPolicyInput) {
  const inactive = input.status !== 'ACTIVE' || input.now >= input.endsAt;
  return validateBidRules({ ...input, acceptsBids: !inactive });
}

export const ANTI_SNIPING_WINDOW_MS = 30_000;
export const ANTI_SNIPING_EXTENSION_MS = 60_000;

export function extendedDeadline(now: Date, endsAt: Date): Date {
  // Accepted bids in the last 30 seconds ensure at least 60 seconds remain.
  return endsAt.getTime() - now.getTime() <= ANTI_SNIPING_WINDOW_MS
    ? new Date(Math.max(endsAt.getTime(), now.getTime() + ANTI_SNIPING_EXTENSION_MS)) : endsAt;
}
