-- Keep migration 001 immutable. Existing invalid rows deliberately fail validation;
-- an operator must investigate them rather than invent a winner or final price.
ALTER TABLE auction_results ADD CONSTRAINT auction_results_complete_winner_check
  CHECK (
    (winner_id IS NULL AND winning_bid_id IS NULL AND final_price_vnd IS NULL)
    OR
    (winner_id IS NOT NULL AND winning_bid_id IS NOT NULL
      AND final_price_vnd IS NOT NULL AND final_price_vnd > 0)
  );

ALTER TABLE auctions ADD CONSTRAINT auctions_version_nonnegative_check
  CHECK (version >= 0);
