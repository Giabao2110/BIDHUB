import type { AuctionStatus } from "@bidhub/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiErrorPanel } from "../../components/api-ui";
import { StatusBadge } from "../../components/ui";
import {
  apiRequest,
  ApiRequestError,
  apiWrite,
  errorMessage,
} from "../../lib/api-client";
import type { User } from "../../lib/models";
import { useAuth } from "../auth/session";

type Auction = { id: string; title: string; status: AuctionStatus };
type Account = User & { disabled: boolean };
type Action =
  { kind: "auction"; item: Auction } | { kind: "user"; item: Account };

export function Moderation() {
  const { user } = useAuth();
  if (user?.role !== "ADMIN")
    return (
      <section className="state-panel">
        <h1>Administrator access required</h1>
        <Link to="/dashboard">Back to my auctions</Link>
      </section>
    );
  return <ModerationPanel key={user.id} />;
}

function ModerationPanel() {
  const auth = useAuth();
  const cache = useQueryClient();
  const [auctionInput, setAuctionInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const prefix = ["private", auth.user?.id, "moderation"];
  const auctions = useQuery({
    queryKey: [...prefix, "auctions", title],
    enabled: !!title,
    retry: false,
    queryFn: ({ signal }) =>
      apiRequest<{ items: Auction[]; truncated: boolean }>(
        `/admin/auctions?q=${encodeURIComponent(title)}`,
        { signal, cache: "no-store" },
      ),
  });
  const accounts = useQuery({
    queryKey: [...prefix, "users", email],
    enabled: !!email,
    retry: false,
    queryFn: ({ signal }) =>
      apiWrite<{ items: Account[] }>(
        "/admin/users/lookup",
        "POST",
        { email },
        { signal },
      ),
  });
  const verb =
    action?.kind === "auction"
      ? "Cancel auction"
      : action?.item.disabled
        ? "Enable account"
        : "Disable account";

  function select(next: Action) {
    setAction(next);
    setReason("");
    setFailure("");
    setNotice("");
  }

  async function confirm() {
    if (!action || !reason.trim() || pending) return;
    setPending(true);
    setFailure("");
    try {
      if (action.kind === "auction") {
        await apiWrite(`/admin/auctions/${action.item.id}/cancel`, "POST", {
          reason: reason.trim(),
        });
        setNotice("Auction cancelled.");
      } else {
        await apiWrite(`/admin/users/${action.item.id}`, "PATCH", {
          disabled: !action.item.disabled,
          reason: reason.trim(),
        });
        setNotice(
          action.item.disabled
            ? "Account enabled."
            : "Account disabled. Existing sessions were revoked.",
        );
        if (action.item.id === auth.user?.id) void auth.refresh();
      }
      setAction(null);
      await Promise.all([
        cache.invalidateQueries({ queryKey: prefix }),
        cache.invalidateQueries({ queryKey: ["auctions"] }),
        cache.invalidateQueries({ queryKey: ["auction"] }),
      ]);
    } catch (error) {
      setFailure(
        error instanceof ApiRequestError && error.code === "LAST_ADMIN"
          ? "The last active administrator cannot be disabled."
          : errorMessage(error),
      );
      if (error instanceof ApiRequestError && [401, 403].includes(error.status))
        void auth.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Link className="back-link" to="/dashboard">
        ← My auctions
      </Link>
      <header className="page-heading">
        <h1>Moderation</h1>
        <p>
          Find an auction or account. Each change requires a reason and is
          recorded.
        </p>
      </header>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {action && (
        <section className="confirmation" aria-labelledby="moderation-confirm">
          <h2 id="moderation-confirm">{verb}?</h2>
          <p>
            {action.kind === "auction" ? action.item.title : action.item.email}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            <label>
              Reason
              <textarea
                required
                maxLength={300}
                value={reason}
                disabled={pending}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {failure && (
              <p className="notice notice-error" role="alert">
                {failure}
              </p>
            )}
            <div className="action-row">
              <button className="button" disabled={pending || !reason.trim()}>
                {pending ? "Working…" : `Confirm ${verb.toLowerCase()}`}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={pending}
                onClick={() => setAction(null)}
              >
                Keep unchanged
              </button>
            </div>
          </form>
        </section>
      )}
      <div className="moderation-grid">
        <section className="form-panel" aria-labelledby="moderate-auctions">
          <h2 id="moderate-auctions">Auctions</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = auctionInput.trim();
              if (next === title) void auctions.refetch();
              else setTitle(next);
            }}
          >
            <label>
              Auction title or ID
              <input
                value={auctionInput}
                required
                maxLength={160}
                onChange={(event) => setAuctionInput(event.target.value)}
              />
            </label>
            <button
              className="button secondary"
              disabled={!auctionInput.trim()}
            >
              Find auctions
            </button>
          </form>
          {title &&
            (auctions.isPending ? (
              <p role="status">Finding auctions…</p>
            ) : auctions.isError ? (
              <ApiErrorPanel
                error={auctions.error}
                retry={() => void auctions.refetch()}
              />
            ) : (
              <>
                {!auctions.data.items.length && <p>No matching auctions.</p>}
                {auctions.data.truncated && (
                  <p>
                    Showing the first 20 matches. Narrow your search to find
                    more.
                  </p>
                )}
                <ul className="moderation-results">
                  {auctions.data.items.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>{" "}
                      <StatusBadge status={item.status} />
                      {!["ENDED", "CANCELLED"].includes(item.status) && (
                        <button
                          className="button small secondary"
                          disabled={pending}
                          onClick={() => select({ kind: "auction", item })}
                        >
                          Cancel auction
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ))}
        </section>
        <section className="form-panel" aria-labelledby="moderate-accounts">
          <h2 id="moderate-accounts">Accounts</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = emailInput.trim().toLowerCase();
              if (next === email) void accounts.refetch();
              else setEmail(next);
            }}
          >
            <label>
              Account email
              <input
                type="email"
                value={emailInput}
                required
                maxLength={254}
                onChange={(event) => setEmailInput(event.target.value)}
              />
            </label>
            <button className="button secondary" disabled={!emailInput.trim()}>
              Find account
            </button>
          </form>
          {email &&
            (accounts.isPending ? (
              <p role="status">Finding account…</p>
            ) : accounts.isError ? (
              <ApiErrorPanel
                error={accounts.error}
                retry={() => void accounts.refetch()}
              />
            ) : (
              <>
                {!accounts.data.items.length && <p>No matching account.</p>}
                <ul className="moderation-results">
                  {accounts.data.items.map((item) => (
                    <li key={item.id}>
                      <strong>{item.displayName}</strong>
                      <span>{item.email}</span>
                      <span>
                        {item.role} · {item.disabled ? "Disabled" : "Enabled"}
                      </span>
                      <button
                        className="button small secondary"
                        disabled={pending}
                        onClick={() => select({ kind: "user", item })}
                      >
                        {item.disabled ? "Enable account" : "Disable account"}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ))}
        </section>
      </div>
    </>
  );
}
