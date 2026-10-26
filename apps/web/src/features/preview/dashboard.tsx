import { useSearchParams } from "react-router-dom";
import { PreviewLink as Link } from "../../app/preview-link";
import { auctionFixtures } from "../../mocks/auctions";
import { StatusBadge } from "../../components/ui";
import { formatMoney } from "../../lib/format";
export function Dashboard() {
  const [params] = useSearchParams();
  const tab = params.get("tab") === "bids" ? "bids" : "auctions";
  const items =
    tab === "auctions"
      ? auctionFixtures.filter((item) =>
          ["DRAFT", "ACTIVE", "SCHEDULED"].includes(item.auction.status),
        )
      : auctionFixtures.filter((item) => item.preview.bidCount > 0);
  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">YOUR ACCOUNT · PREVIEW</p>
          <h1>
            Follow your
            <br />
            <em>auction journey.</em>
          </h1>
          <p>Sample account layout. No user is signed in.</p>
        </div>
        <Link className="button" to="/auctions/new">
          + Preview an auction
        </Link>
      </div>
      <div className="dashboard-note notice">
        These listings are sample data. Your auctions and bids will load from
        your account once connected.
      </div>
      <div className="dashboard-tabs" aria-label="Choose an account list">
        <Link
          to="?tab=auctions"
          aria-current={tab === "auctions" ? "page" : undefined}
        >
          My auctions
        </Link>
        <Link to="?tab=bids" aria-current={tab === "bids" ? "page" : undefined}>
          My bids
        </Link>
      </div>
      <div className="dashboard-list">
        {items.map((item) => (
          <article className="dashboard-row" key={item.auction.id}>
            <div>
              <p className="eyebrow">{item.category.name}</p>
              <h2>{item.auction.title}</h2>
            </div>
            <StatusBadge status={item.auction.status} />
            <strong>{formatMoney(item.auction.currentPriceVnd)}</strong>
            {item.auction.status === "DRAFT" ? (
              <span className="helper">Draft editing is not connected</span>
            ) : (
              <Link className="text-link" to={`/auctions/${item.auction.id}`}>
                View auction ↗
              </Link>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
