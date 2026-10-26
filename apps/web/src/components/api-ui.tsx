import { Link } from "react-router-dom";
import { errorMessage, ApiRequestError } from "../lib/api-client";
import { useAuth } from "../features/auth/session";
import { useEffect } from "react";
import { formatMoney } from "../lib/format";
import type { AuctionDetailDto } from "../lib/models";
import { StatusBadge, Countdown } from "./ui";

export function ApiErrorPanel({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const auth = useAuth();
  useEffect(() => {
    if (error instanceof ApiRequestError && error.status === 401)
      void auth.refresh();
  }, [error]);
  return (
    <section className="state-panel">
      <h2>Unable to load data</h2>
      <p role="alert">{errorMessage(error)}</p>
      <div className="action-row">
        {retry && (
          <button className="button secondary" onClick={retry}>
            Try again
          </button>
        )}
        <Link className="text-link" to="/preview/auctions">
          View preview
        </Link>
      </div>
    </section>
  );
}
export function ProductImage({
  url,
  title,
}: {
  url: string | null;
  title: string;
}) {
  const allowed = url && /^https:\/\//i.test(url);
  return (
    <div className="product-art live-product">
      {allowed ? (
        <img
          src={url}
          alt={title}
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
      <span>Item image{!allowed ? " not provided yet" : ""}</span>
    </div>
  );
}
export function LiveCard({
  item,
  receivedAt,
}: {
  item: AuctionDetailDto;
  receivedAt: number;
}) {
  return (
    <article className="auction-card">
      <Link
        className="card-image"
        to={`/auctions/${item.auction.id}`}
        aria-label={`View ${item.auction.title}`}
      >
        <ProductImage url={item.imageUrl} title={item.auction.title} />
        <StatusBadge status={item.auction.status} />
      </Link>
      <div className="card-content">
        <p className="eyebrow">{item.category.name}</p>
        <h3>
          <Link to={`/auctions/${item.auction.id}`}>{item.auction.title}</Link>
        </h3>
        <div className="card-price">
          <div>
            <span className="field-caption">Current bid</span>
            <strong>{formatMoney(item.auction.currentPriceVnd)}</strong>
          </div>
        </div>
        <div className="card-bottom">
          <span>Status / time</span>
          <Countdown auction={item.auction} receivedAt={receivedAt} />
        </div>
      </div>
    </article>
  );
}
export function Pagination({
  page,
  total,
  pageSize,
  change,
}: {
  page: number;
  total: number;
  pageSize: number;
  change: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        className="button secondary"
        disabled={page <= 1}
        onClick={() => change(page - 1)}
      >
        Previous page
      </button>
      <span>
        Page {page} / {pages}
      </span>
      <button
        className="button secondary"
        disabled={page >= pages}
        onClick={() => change(page + 1)}
      >
        Next page
      </button>
    </nav>
  );
}
