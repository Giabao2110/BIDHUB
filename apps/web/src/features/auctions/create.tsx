import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { auctionsApi } from "../../lib/auctions-api";
import { errorMessage, ApiRequestError } from "../../lib/api-client";
import { ApiErrorPanel } from "../../components/api-ui";
import { StatePanel } from "../../components/ui";
import type { AuctionDetailDto, DraftInput } from "../../lib/models";
import { useAuth } from "../auth/session";
function localDate(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
export function CreateAuction() {
  const { id } = useParams();
  const auth = useAuth();
  const draft = useQuery({
    queryKey: ["private", auth.user?.id, "draft", id],
    enabled: !!id,
    queryFn: ({ signal }) => auctionsApi.detail(id!, signal),
    staleTime: 0,
  });
  if (id && draft.isPending) return <StatePanel kind="loading" />;
  if (id && draft.isError)
    return (
      <ApiErrorPanel error={draft.error} retry={() => void draft.refetch()} />
    );
  if (id && draft.data) {
    if (draft.data.seller.id !== auth.user?.id)
      return (
        <section className="state-panel">
          <h1>You cannot edit this auction</h1>
          <Link to="/dashboard">Back to my auctions</Link>
        </section>
      );
    if (draft.data.auction.status !== "DRAFT")
      return (
        <section className="state-panel">
          <h1>Published auctions cannot be edited</h1>
          <Link to={`/auctions/${id}`}>View auction</Link>
        </section>
      );
    if (!draft.data.startsAt)
      return (
        <section className="state-panel">
          <h1>Draft details are incomplete</h1>
          <p>
            The server must provide the start time before this draft can be
            edited safely.
          </p>
          <Link to="/dashboard">Back to my auctions</Link>
        </section>
      );
  }
  return (
    <DraftForm
      key={`${auth.user?.id}:${id ?? "new"}`}
      initial={draft.data}
      id={id}
    />
  );
}
function DraftForm({
  initial,
  id,
}: {
  initial?: AuctionDetailDto;
  id?: string;
}) {
  const auth = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: ({ signal }) => auctionsApi.categories(signal),
  });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const guard = useRef(false);
  guard.current = dirty;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (guard.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const values = new FormData(event.currentTarget);
    const title = String(values.get("title")).trim(),
      description = String(values.get("description")).trim();
    const price = String(values.get("openingPriceVnd")),
      increment = String(values.get("minimumIncrementVnd"));
    if (!title || !description) {
      setError("Add a title and description, not just spaces.");
      return;
    }
    if (
      ![price, increment].every(
        (value) =>
          /^[1-9]\d*$/.test(value) && BigInt(value) <= 9223372036854775807n,
      )
    ) {
      setError(
        "Prices and increments must be positive whole VND amounts within the BIGINT limit.",
      );
      return;
    }
    const startsAt = new Date(String(values.get("startsAt"))),
      endsAt = new Date(String(values.get("endsAt")));
    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      endsAt <= startsAt ||
      endsAt.getTime() <= Date.now()
    ) {
      setError("The end time must be after the start time and in the future.");
      return;
    }
    const imageUrl = String(values.get("imageUrl") ?? "").trim() || null;
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
      setError("The image URL must use HTTPS.");
      return;
    }
    const input: DraftInput = {
      title,
      description,
      categoryId: String(values.get("categoryId")),
      imageUrl,
      openingPriceVnd: price,
      minimumIncrementVnd: increment,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
    setError("");
    setPending(true);
    try {
      await auctionsApi.save(input, id);
      guard.current = false;
      setDirty(false);
      await client.invalidateQueries({ queryKey: ["private", auth.user?.id] });
      navigate("/dashboard?notice=saved", { replace: true });
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
      <Link
        className="back-link"
        to="/dashboard"
        onClick={(event) => {
          if (
            dirty &&
            !window.confirm("You have unsaved changes. Leave this form?")
          )
            event.preventDefault();
        }}
      >
        ← My auctions
      </Link>
      <div className="page-heading">
        <p className="eyebrow">FOR SELLERS</p>
        <h1>
          {id ? "Refine your draft." : "Your item. Your story."}
          <br />
          <em>A new chapter.</em>
        </h1>
        <p>
          Save your draft, review the details, then publish from My auctions.
        </p>
      </div>
      <div className="create-layout">
        <section className="form-panel">
          <form
            onSubmit={submit}
            onChange={() => {
              setDirty(true);
              setError("");
            }}
          >
            <fieldset disabled={pending}>
              <h2>Item details</h2>
              <label>
                Item title
                <input
                  name="title"
                  required
                  maxLength={160}
                  defaultValue={initial?.auction.title}
                />
              </label>
              <label>
                Category
                <select
                  name="categoryId"
                  aria-label="Category"
                  required
                  defaultValue={initial?.category.id ?? ""}
                  disabled={!categories.data}
                >
                  <option value="" disabled>
                    Choose a category
                  </option>
                  {categories.data?.items.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              {categories.isError && (
                <p className="notice notice-error" role="alert">
                  Unable to load categories.{" "}
                  <button
                    className="inline-button"
                    type="button"
                    onClick={() => void categories.refetch()}
                  >
                    Reload categories
                  </button>
                </p>
              )}
              <label>
                Description
                <textarea
                  name="description"
                  required
                  rows={5}
                  defaultValue={initial?.description}
                />
              </label>
              <label>
                HTTPS image URL (optional)
                <input
                  name="imageUrl"
                  type="url"
                  defaultValue={initial?.imageUrl ?? ""}
                  placeholder="https://…"
                />
              </label>
              <p className="helper">
                Use an approved image URL. Image uploads are not available yet.
              </p>
              <h2>Auction settings</h2>
              <div className="form-row">
                <label>
                  Starting bid (VND)
                  <input
                    name="openingPriceVnd"
                    inputMode="numeric"
                    pattern="[1-9][0-9]*"
                    required
                    defaultValue={
                      initial?.openingPriceVnd ??
                      initial?.auction.currentPriceVnd
                    }
                  />
                </label>
                <label>
                  Bid increment (VND)
                  <input
                    name="minimumIncrementVnd"
                    inputMode="numeric"
                    pattern="[1-9][0-9]*"
                    required
                    defaultValue={initial?.auction.minimumIncrementVnd}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Starts at
                  <input
                    name="startsAt"
                    type="datetime-local"
                    required
                    defaultValue={
                      initial?.startsAt
                        ? localDate(initial.startsAt)
                        : undefined
                    }
                  />
                </label>
                <label>
                  Ends at
                  <input
                    name="endsAt"
                    type="datetime-local"
                    required
                    defaultValue={
                      initial ? localDate(initial.auction.endsAt) : undefined
                    }
                  />
                </label>
              </div>
              <p className="helper">
                Enter times in your device time zone (
                {Intl.DateTimeFormat().resolvedOptions().timeZone}). Times are
                sent in UTC. The server determines whether a published auction
                starts immediately or is scheduled.
              </p>
              <button
                className="button"
                type="submit"
                disabled={!categories.data}
              >
                {pending ? "Saving…" : id ? "Save changes" : "Save draft"}
              </button>
            </fieldset>
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </section>
        <aside className="seller-guide">
          <p className="eyebrow">DRAFT → PUBLISH → FOLLOW</p>
          <ol>
            <li>
              <strong>Tell its story</strong>
              <p>Describe its condition and included accessories.</p>
            </li>
            <li>
              <strong>Review your draft</strong>
              <p>Edit or delete it before publishing.</p>
            </li>
            <li>
              <strong>Publish your auction</strong>
              <p>
                After publishing, prices and schedules are managed by the
                auction rules.
              </p>
            </li>
          </ol>
        </aside>
      </div>
    </>
  );
}
