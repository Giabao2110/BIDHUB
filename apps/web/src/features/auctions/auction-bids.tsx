import type { AuctionSnapshot } from "@bidhub/contracts";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ApiRequestError,
  apiRequest,
  apiWrite,
  errorMessage,
} from "../../lib/api-client";
import { formatDate, formatMoney } from "../../lib/format";

type Attempt = { key: string; amount: string };
type BidHistory = {
  items: {
    id: string;
    amountVnd: string;
    bidderDisplayName: string;
    createdAt: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
};
type AuctionResult = {
  winner: { id: string; displayName: string } | null;
  finalPriceVnd: string | null;
  closedAt: string;
};

export function AuctionBids({
  auction,
  sellerId,
  userId,
  refresh,
}: {
  auction: AuctionSnapshot;
  sellerId: string;
  userId?: string;
  refresh: () => void;
}) {
  const path = `/auctions/${auction.id}`;
  const [amount, setAmount] = useState("");
  const [retry, setRetry] = useState<Attempt | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const inFlight = useRef(false);
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: ["bid-history", auction.id, auction.version, page],
    queryFn: ({ signal }) =>
      apiRequest<BidHistory>(`${path}/bids?page=${page}&pageSize=20`, {
        signal,
      }),
    enabled: auction.status !== "DRAFT",
    gcTime: 30_000,
    retry: false,
  });
  const result = useQuery({
    queryKey: ["auction-result", auction.id, auction.version],
    queryFn: ({ signal }) =>
      apiRequest<AuctionResult>(`${path}/result`, { signal }),
    enabled: auction.status === "ENDED",
    retry: false,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const entered = amount.trim();
    if (
      !retry &&
      (!/^[1-9]\d{0,18}$/.test(entered) ||
        BigInt(entered) > 9_223_372_036_854_775_807n)
    ) {
      setMessage({ text: "Enter a positive whole VND amount.", error: true });
      return;
    }
    const attempt = retry ?? { key: crypto.randomUUID(), amount: entered };
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    try {
      const response = await apiWrite<{ bidId: string }>(
        `${path}/bids`,
        "POST",
        { amountVnd: attempt.amount },
        {
          headers: { "Idempotency-Key": attempt.key },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (typeof response?.bidId !== "string" || !response.bidId)
        throw new Error("Invalid bid receipt");
      setRetry(null);
      setAmount("");
      setPage(1);
      setMessage({ text: "Bid accepted." });
      void history.refetch();
    } catch (error) {
      const unknown =
        !(error instanceof ApiRequestError) ||
        error.status >= 500 ||
        error.status === 408 ||
        error.status === 429;
      setRetry(unknown ? attempt : null);
      setMessage({
        text: unknown
          ? "Bid could not be confirmed. Retry the same bid to check it without sending a duplicate."
          : errorMessage(error),
        error: true,
      });
      if (unknown) void history.refetch();
    } finally {
      refresh();
      inFlight.current = false;
      setPending(false);
    }
  }

  if (auction.status === "DRAFT") return null;
  return (
    <>
      {(auction.status === "ACTIVE" || retry) &&
        (userId === sellerId ? (
          <p className="helper">You cannot bid on your own auction.</p>
        ) : !userId ? (
          <Link
            className="button full"
            to={`/login?returnTo=${encodeURIComponent(path)}`}
          >
            Sign in to bid
          </Link>
        ) : (
          <form onSubmit={submit} className="bid-form">
            <label htmlFor="bid-amount">Bid amount (VND)</label>
            <input
              id="bid-amount"
              inputMode="numeric"
              autoComplete="off"
              maxLength={19}
              value={retry?.amount ?? amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={pending || !!retry}
              required
            />
            <button type="submit" className="button full" disabled={pending}>
              {pending ? "Submitting…" : retry ? "Retry same bid" : "Place bid"}
            </button>
          </form>
        ))}
      {message && (
        <p role={message.error ? "alert" : "status"}>{message.text}</p>
      )}
      {auction.status === "ENDED" && (
        <section>
          <h2>Auction result</h2>
          {result.isPending ? (
            <p>Loading result…</p>
          ) : result.isError ? (
            <button type="button" onClick={() => void result.refetch()}>
              Retry loading result
            </button>
          ) : result.data.winner && result.data.finalPriceVnd !== null ? (
            <p>
              {result.data.winner.displayName} won at{" "}
              {formatMoney(result.data.finalPriceVnd)}.
            </p>
          ) : (
            <p>No winning bid.</p>
          )}
        </section>
      )}
      <section>
        <h2>Bid history</h2>
        {history.isPending ? (
          <p>Loading bids…</p>
        ) : history.isError ? (
          <button type="button" onClick={() => void history.refetch()}>
            Retry loading bid history
          </button>
        ) : (
          <>
            {history.data.items.length === 0 ? (
              <p>No bids on this page.</p>
            ) : (
              <ul>
                {history.data.items.map((bid) => (
                  <li key={bid.id}>
                    {bid.bidderDisplayName} — {formatMoney(bid.amountVnd)} ·{" "}
                    {formatDate(bid.createdAt)}
                  </li>
                ))}
              </ul>
            )}
            {page > 1 && (
              <button type="button" onClick={() => setPage(page - 1)}>
                Previous bids
              </button>
            )}
            {page * history.data.pageSize < history.data.total && (
              <button type="button" onClick={() => setPage(page + 1)}>
                More bids
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}
