import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { PreviewLink as Link } from "../../app/preview-link";
import {
  AuctionCard,
  Countdown,
  ProductArt,
  StatePanel,
  StatusBadge,
} from "../../components/ui";
import { previewCategories, readPreviewAuctions } from "../../mocks/auctions";
import { formatDate, formatMoney } from "../../lib/format";
export function AuctionList() {
  const [params, setParams] = useSearchParams();
  const query = params.get("query") ?? "",
    category = params.get("category") ?? "",
    status = params.get("status") ?? "",
    state = params.get("state") ?? "";
  const auctions = useQuery({
    queryKey: ["preview-auctions", state],
    queryFn: ({ signal }) => readPreviewAuctions(signal, state === "error"),
  });
  const setFilter = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  const filtered = (auctions.data ?? []).filter(
    (item) =>
      item.auction.status !== "DRAFT" &&
      item.auction.title
        .toLocaleLowerCase("vi")
        .includes(query.toLocaleLowerCase("vi")) &&
      (!category || item.category.name === category) &&
      (!status || item.auction.status === status),
  );
  const reset = () => setParams({});
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">
            <span className="line-mark" />
            THE ONLINE AUCTION MARKETPLACE
          </p>
          <h1>
            Discover the exceptional.
            <br />
            <em>Make it yours.</em>
          </h1>
          <p className="hero-copy">
            Extraordinary objects. Everyday discoveries.
            <br />
            Follow the auction. Find your moment.
          </p>
          <a className="text-link" href="#auction-list">
            Explore auctions <span aria-hidden="true">↓</span>
          </a>
        </div>
        <div className="hero-feature">
          <div className="feature-note">
            <span>THE DISCOVERY EDIT</span>
            <span>01 / 05</span>
          </div>
          <ProductArt kind="camera" />
          <div className="feature-bottom">
            <span>Objects with a story to tell.</span>
            <span className="circle-arrow" aria-hidden="true">
              ↗
            </span>
          </div>
        </div>
      </section>
      <section id="auction-list" className="listing-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">FIND YOUR NEXT FAVORITE</p>
            <h2>
              Explore auctions<span className="brand-dot">.</span>
            </h2>
          </div>
          <span className="sample-chip">Sample listings</span>
        </div>
        <form
          className="filter-bar"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="search-field">
            <span className="sr-only">Search auctions</span>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="What will you discover today?"
              value={query}
              onChange={(event) => setFilter("query", event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Category</span>
            <select
              aria-label="Category"
              value={category}
              onChange={(event) => setFilter("category", event.target.value)}
            >
              <option value="">All categories</option>
              {previewCategories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Auction status</span>
            <select
              aria-label="Auction status"
              value={status}
              onChange={(event) => setFilter("status", event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Live</option>
              <option value="SCHEDULED">Upcoming</option>
              <option value="ENDED">Ended</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
        </form>
        <div className="listing-meta">
          <span>
            {state === "empty" ? 0 : filtered.length} sample auctions
            {(query || category || status) && (
              <button className="inline-button" onClick={reset}>
                Clear filters
              </button>
            )}
          </span>
          <label className="preview-control">
            Preview display{" "}
            <select
              aria-label="Preview state"
              value={state}
              onChange={(event) => setFilter("state", event.target.value)}
            >
              <option value="">Default</option>
              <option value="loading">Loading</option>
              <option value="empty">Empty</option>
              <option value="error">Connection error</option>
            </select>
          </label>
        </div>
        {auctions.isPending || state === "loading" ? (
          <StatePanel kind="loading" />
        ) : auctions.isError ? (
          <StatePanel kind="error" onRetry={() => setFilter("state", "")} />
        ) : !filtered.length || state === "empty" ? (
          <StatePanel kind="empty" onRetry={reset} />
        ) : (
          <div className="auction-grid">
            {filtered.map((item) => (
              <AuctionCard key={item.auction.id} item={item} />
            ))}
          </div>
        )}
      </section>
      <aside className="bottom-note">
        <span aria-hidden="true">↗</span>
        <div>
          <h2>Your next chapter starts with something to sell.</h2>
          <p>Explore the selling experience in the preview.</p>
        </div>
        <Link className="button secondary" to="/auctions/new">
          Start your selling story →
        </Link>
      </aside>
    </>
  );
}
export function AuctionDetail() {
  const { id } = useParams();
  const data = useQuery({
    queryKey: ["preview-auctions", ""],
    queryFn: ({ signal }) => readPreviewAuctions(signal),
  });
  if (data.isPending) return <StatePanel kind="loading" />;
  if (data.isError)
    return (
      <StatePanel
        kind="error"
        onRetry={() => {
          void data.refetch();
        }}
      />
    );
  const item = data.data.find(
    (row) => row.auction.id === id && row.auction.status !== "DRAFT",
  );
  if (!item)
    return (
      <section className="state-panel">
        <h1>Auction not found</h1>
        <p>This auction does not exist or has not been published.</p>
        <Link className="button" to="/auctions">
          Back to listings
        </Link>
      </section>
    );
  return (
    <>
      <Link className="back-link" to="/auctions">
        ← Explore auctions
      </Link>
      <div className="detail-grid">
        <div>
          <div className="detail-art">
            <ProductArt kind={item.preview.artwork} />
          </div>
          <section className="description">
            <p className="eyebrow">ITEM DETAILS</p>
            <h2>Every object has a story</h2>
            <p>{item.description}</p>
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
          <p className="muted">
            The item details and bids below are sample data.
          </p>
          <div className="detail-price">
            <span>
              {item.preview.bidCount ? "Current bid" : "Starting bid"}
            </span>
            <strong>{formatMoney(item.auction.currentPriceVnd)}</strong>
            <span>
              Bid increment: {formatMoney(item.auction.minimumIncrementVnd)}
            </span>
          </div>
          <div className="timer-block">
            <span>
              {item.auction.status === "ACTIVE"
                ? "Time remaining"
                : "Auction status"}
            </span>
            <strong>
              <Countdown
                auction={item.auction}
                receivedAt={item.preview.receivedAt}
              />
            </strong>
          </div>
          <button className="button full" disabled>
            Bidding coming soon
          </button>
          <p className="helper">
            Bidding and live updates are not connected yet. No transaction will
            be sent.
          </p>
          <Link className="text-link" to="/login">
            Preview sign-in ↗
          </Link>
          <div className="bid-history">
            <h2>Bid history</h2>
            <p>
              {item.preview.bidCount
                ? `${item.preview.bidCount} sample bids. Detailed bid history will load from the API.`
                : "No bids in this sample auction."}
            </p>
            {item.auction.status === "ENDED" && (
              <p role="status">The winner will be confirmed by the server.</p>
            )}
            {item.auction.status === "CANCELLED" && (
              <p role="status">
                This sample auction was cancelled and cannot accept bids.
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
