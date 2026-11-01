import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { auctionsApi } from "../../lib/auctions-api";
import { ApiErrorPanel, Pagination } from "../../components/api-ui";
import { StatePanel, StatusBadge } from "../../components/ui";
import { useAuth } from "../auth/session";
import { errorMessage, ApiRequestError } from "../../lib/api-client";
import { formatMoney } from "../../lib/format";
import type { AuctionDetailDto } from "../../lib/models";
export function Dashboard() {
  const auth = useAuth();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const query = useQuery({
    queryKey: ["private", auth.user?.id, "auctions", page],
    queryFn: ({ signal }) => auctionsApi.mine(page, signal),
    staleTime: 0,
  });
  const [action, setAction] = useState<{
    type: "publish" | "delete";
    item: AuctionDetailDto;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function confirm() {
    if (!action || pending) return;
    setPending(true);
    setError("");
    try {
      if (action.type === "publish")
        await auctionsApi.publish(action.item.auction.id);
      else await auctionsApi.remove(action.item.auction.id);
      setMessage(
        action.type === "publish"
          ? "Auction published. Confirmed by the server."
          : "Draft deleted.",
      );
      setAction(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["private", auth.user?.id] }),
        client.invalidateQueries({ queryKey: ["auctions"] }),
        client.invalidateQueries({ queryKey: ["auction"] }),
      ]);
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ApiRequestError && failure.status === 401)
        void auth.refresh();
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">YOUR COLLECTION STARTS HERE</p>
          <h1>
            Your auctions
            <br />
            <em>Your next chapter.</em>
          </h1>
          <p>
            Welcome back, {auth.user?.displayName}. Manage your drafts and
            published auctions.
          </p>
        </div>
        <Link className="button" to="/auctions/new">
          + Create auction
        </Link>
      </div>
      {params.get("notice") === "saved" && (
        <p className="notice" role="status">
          Draft saved. Confirmed by the server.
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {action && (
        <section className="confirmation" aria-labelledby="confirmation-title">
          <h2 id="confirmation-title">
            {action.type === "publish"
              ? "Publish this auction?"
              : "Delete this draft?"}
          </h2>
          <p>
            <strong>{action.item.auction.title}</strong>
          </p>
          <p>
            {action.type === "publish"
              ? "Once published, you cannot change the price or schedule."
              : "This draft will be permanently deleted. This cannot be undone."}
          </p>
          <div className="action-row">
            <button
              className="button"
              disabled={pending}
              onClick={() => void confirm()}
            >
              {pending
                ? "Working…"
                : action.type === "publish"
                  ? "Confirm publish"
                  : "Confirm delete"}
            </button>
            <button
              className="button secondary"
              disabled={pending}
              onClick={() => {
                setAction(null);
                setError("");
              }}
            >
              Keep draft
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {query.isPending ? (
        <StatePanel kind="loading" />
      ) : query.isError ? (
        <ApiErrorPanel error={query.error} retry={() => void query.refetch()} />
      ) : !query.data.items.length ? (
        <section className="state-panel">
          <h2>No auctions yet</h2>
          <p>Start with a draft and take it from there.</p>
          <Link className="button" to="/auctions/new">
            Create your first auction
          </Link>
        </section>
      ) : (
        <>
          <div className="dashboard-list">
            {query.data.items.map((item) => (
              <article
                className="dashboard-row seller-row"
                key={item.auction.id}
              >
                <div>
                  <p className="eyebrow">{item.category.name}</p>
                  <h2>{item.auction.title}</h2>
                </div>
                <StatusBadge status={item.auction.status} />
                <strong>{formatMoney(item.auction.currentPriceVnd)}</strong>
                <div className="seller-actions">
                  {item.auction.status === "DRAFT" &&
                  item.seller.id === auth.user?.id ? (
                    <>
                      <Link
                        className="text-link"
                        to={`/auctions/${item.auction.id}/edit`}
                      >
                        Edit draft
                      </Link>
                      <button
                        className="button small"
                        disabled={pending}
                        onClick={() => {
                          setAction({ type: "publish", item });
                          setError("");
                        }}
                      >
                        Publish
                      </button>
                      <button
                        className="inline-button"
                        disabled={pending}
                        onClick={() => {
                          setAction({ type: "delete", item });
                          setError("");
                        }}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <Link
                      className="text-link"
                      to={`/auctions/${item.auction.id}`}
                    >
                      View auction ↗
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
          <Pagination
            page={query.data.page}
            total={query.data.total}
            pageSize={query.data.pageSize}
            change={(next) => setParams({ page: String(next) })}
          />
        </>
      )}
    </>
  );
}
