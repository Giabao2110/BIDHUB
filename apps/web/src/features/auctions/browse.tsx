import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { auctionsApi } from "../../lib/auctions-api";
import {
  ApiErrorPanel,
  LiveCard,
  Pagination,
  ProductImage,
} from "../../components/api-ui";
import { Countdown, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate, formatMoney } from "../../lib/format";
import { ApiRequestError } from "../../lib/api-client";
import { useAuth } from "../auth/session";
export function AuctionList() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("query") ?? "");
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const requested = new URLSearchParams({ page: String(page), pageSize: "20" });
  for (const key of ["query", "categoryId", "status"])
    if (params.get(key)) requested.set(key, params.get(key)!);
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: ({ signal }) => auctionsApi.categories(signal),
  });
  const auctions = useQuery({
    queryKey: ["auctions", requested.toString()],
    queryFn: ({ signal }) => auctionsApi.list(requested, signal),
  });
  useEffect(() => setSearch(params.get("query") ?? ""), [params]);
  const update = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    });
  return (
    <>
      <section className="page-heading live-heading">
        <p className="eyebrow">DISCOVER BIDHUB</p>
        <h1>
          Discover the exceptional.
          <br />
          <em>Make it yours.</em>
        </h1>
        <p>Explore auctions and find something worth bidding for.</p>
      </section>
      <section>
        <form
          className="filter-bar"
          onSubmit={(event) => {
            event.preventDefault();
            update("query", search.trim());
          }}
        >
          <label className="search-field">
            <span className="sr-only">Search auctions</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search for an item…"
            />
            <button className="inline-button" type="submit">
              Search
            </button>
          </label>
          <label>
            <span className="sr-only">Category</span>
            <select
              aria-label="Category"
              value={params.get("categoryId") ?? ""}
              onChange={(event) => update("categoryId", event.target.value)}
              disabled={!categories.data}
            >
              <option value="">All categories</option>
              {categories.data?.items.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Auction status</span>
            <select
              aria-label="Auction status"
              value={params.get("status") ?? ""}
              onChange={(event) => update("status", event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Live</option>
              <option value="SCHEDULED">Upcoming</option>
              <option value="ENDED">Ended</option>
            </select>
          </label>
        </form>
        {categories.isError && (
          <p className="notice notice-error" role="alert">
            Unable to load categories. You can still search by name or filter by
            status.{" "}
            <button
              className="inline-button"
              onClick={() => void categories.refetch()}
            >
              Reload categories
            </button>
          </p>
        )}
        <div className="listing-meta">
          <span>
            {auctions.data
              ? `${auctions.data.total} auctions`
              : "Auction listings"}
          </span>
          <button className="inline-button" onClick={() => setParams({})}>
            Clear filters
          </button>
        </div>
        {auctions.isPending ? (
          <StatePanel kind="loading" />
        ) : auctions.isError ? (
          <ApiErrorPanel
            error={auctions.error}
            retry={() => void auctions.refetch()}
          />
        ) : !auctions.data.items.length ? (
          <StatePanel kind="empty" onRetry={() => setParams({})} />
        ) : (
          <>
            <div className="auction-grid">
              {auctions.data.items.map((item) => (
                <LiveCard
                  key={item.auction.id}
                  item={item}
                  receivedAt={auctions.dataUpdatedAt}
                />
              ))}
            </div>
            <Pagination
              page={auctions.data.page}
              total={auctions.data.total}
              pageSize={auctions.data.pageSize}
              change={(next) => update("page", String(next))}
            />
          </>
        )}
      </section>
    </>
  );
}
export function AuctionDetail() {
  const { id = "" } = useParams();
  const auth = useAuth();
  const detail = useQuery({
    queryKey: ["auction", auth.user?.id, id],
    queryFn: ({ signal }) => auctionsApi.detail(id, signal),
    refetchInterval: 15_000,
    staleTime: 0,
  });
  if (detail.isPending) return <StatePanel kind="loading" />;
  if (detail.isError)
    return detail.error instanceof ApiRequestError &&
      detail.error.status === 404 ? (
      <section className="state-panel">
        <h1>Auction not found</h1>
        <p>This auction does not exist or has not been published.</p>
        <Link className="button" to="/auctions">
          Back to listings
        </Link>
      </section>
    ) : (
      <ApiErrorPanel error={detail.error} retry={() => void detail.refetch()} />
    );
  const item = detail.data;
  return (
    <>
      <Link className="back-link" to="/auctions">
        ← Explore auctions
      </Link>
      <div className="detail-grid">
        <div>
          <div className="detail-art">
            <ProductImage url={item.imageUrl} title={item.auction.title} />
          </div>
          <section className="description">
            <h2>Item details</h2>
            <p className="preserve-lines">{item.description}</p>
            <dl className="facts">
              <div>
                <dt>Seller</dt>
                <dd>{item.seller.displayName}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{item.category.name}</dd>
              </div>
              <div>
                <dt>Scheduled end</dt>
                <dd>{formatDate(item.auction.endsAt)} (Vietnam time)</dd>
              </div>
            </dl>
          </section>
        </div>
        <section className="bid-panel">
          <StatusBadge status={item.auction.status} />
          <p className="eyebrow detail-category">{item.category.name}</p>
          <h1>{item.auction.title}</h1>
          <div className="detail-price">
            <span>Current bid</span>
            <strong>{formatMoney(item.auction.currentPriceVnd)}</strong>
            <span>
              Bid increment: {formatMoney(item.auction.minimumIncrementVnd)}
            </span>
          </div>
          <div className="timer-block">
            <span>
              {item.auction.status === "ACTIVE" ? "Time remaining" : "Status"}
            </span>
            <strong>
              <Countdown
                auction={item.auction}
                receivedAt={detail.dataUpdatedAt}
              />
            </strong>
          </div>
          {auth.user?.id === item.seller.id &&
            item.auction.status === "DRAFT" && (
              <Link className="button full" to={`/auctions/${id}/edit`}>
                Edit draft
              </Link>
            )}
          <button className="button full" disabled>
            Bidding coming soon
          </button>
          <p className="helper">
            Bidding and live updates are coming in the next phase. The countdown
            uses server time and refreshes every 15 seconds.
          </p>
          {item.auction.status === "ENDED" && (
            <p className="notice">
              This auction has ended. The server will confirm the result; the
              countdown does not determine the winner.
            </p>
          )}
          {item.auction.status === "CANCELLED" && (
            <p className="notice">
              This auction was cancelled and cannot accept bids.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
