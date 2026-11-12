import type { AuctionStatus } from "@bidhub/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ApiErrorPanel, Pagination } from "../../components/api-ui";
import { StatePanel, StatusBadge } from "../../components/ui";
import { apiRequest } from "../../lib/api-client";
import { formatDate, formatMoney } from "../../lib/format";
import type { PageResult } from "../../lib/models";
import { useAuth } from "../auth/session";

type PersonalBid = {
  id: string;
  auctionId: string;
  auctionTitle: string;
  auctionStatus: AuctionStatus;
  amountVnd: string;
  createdAt: string;
};

export function MyBids() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("page") ?? 1);
  const page =
    Number.isInteger(requested) && requested > 0 && requested <= 2_147_483_647
      ? requested
      : 1;
  const query = useQuery({
    queryKey: ["private", user?.id, "bids", page],
    queryFn: ({ signal }) =>
      apiRequest<PageResult<PersonalBid>>(`/me/bids?page=${page}&pageSize=20`, {
        signal,
        cache: "no-store",
      }),
    retry: false,
    staleTime: 0,
    refetchInterval: 15_000,
  });

  return (
    <>
      <Link className="back-link" to="/dashboard">
        ← My auctions
      </Link>
      <header className="page-heading">
        <h1>My bids</h1>
        <p>
          Track the bids you have submitted and each auction’s current status.
        </p>
      </header>
      {query.isPending ? (
        <StatePanel kind="loading" />
      ) : query.isError ? (
        <ApiErrorPanel error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {!query.data.items.length && (
            <p className="notice">No bids on this page.</p>
          )}
          <div className="dashboard-list">
            {query.data.items.map((bid) => (
              <article className="dashboard-row" key={bid.id}>
                <div>
                  <h2>
                    <Link to={`/auctions/${bid.auctionId}`}>
                      {bid.auctionTitle}
                    </Link>
                  </h2>
                  <time dateTime={bid.createdAt}>
                    {formatDate(bid.createdAt)}
                  </time>
                </div>
                <StatusBadge status={bid.auctionStatus} />
                <strong>{formatMoney(bid.amountVnd)}</strong>
              </article>
            ))}
          </div>
          {query.data.total > query.data.pageSize || page > 1 ? (
            <Pagination
              {...query.data}
              change={(next) => setParams({ page: String(next) })}
            />
          ) : null}
        </>
      )}
    </>
  );
}
