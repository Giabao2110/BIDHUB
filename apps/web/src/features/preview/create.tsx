import { useState, type FormEvent } from "react";
import { PreviewLink as Link } from "../../app/preview-link";
import { previewCategories } from "../../mocks/auctions";
export function CreateAuction() {
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const price = String(data.get("openingPriceVnd")),
      increment = String(data.get("minimumIncrementVnd"));
    if (
      !String(data.get("title")).trim() ||
      !String(data.get("description")).trim()
    ) {
      setFeedback({
        error: true,
        text: "Add a title and description, not just spaces.",
      });
      return;
    }
    if (
      ![price, increment].every(
        (value) =>
          /^[1-9]\d*$/.test(value) && BigInt(value) <= 9223372036854775807n,
      )
    ) {
      setFeedback({
        error: true,
        text: "Prices and increments must be positive whole VND amounts within the BIGINT limit.",
      });
      return;
    }
    const start = new Date(String(data.get("startsAt"))).getTime(),
      end = new Date(String(data.get("endsAt"))).getTime();
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start <= Date.now() ||
      end <= start
    ) {
      setFeedback({
        error: true,
        text: "Choose a future start time and an end time after the start.",
      });
      return;
    }
    setFeedback({
      error: false,
      text: "The form is valid. No auction has been created or saved. Saving and publishing are not available in this preview.",
    });
  }
  return (
    <>
      <Link className="back-link" to="/auctions">
        ← Discover
      </Link>
      <div className="page-heading">
        <p className="eyebrow">FOR SELLERS</p>
        <h1>
          Your item. Your story.
          <br />
          <em>A new chapter.</em>
        </h1>
        <p>Give your item a new beginning. Start with the details.</p>
      </div>
      <div className="create-layout">
        <section className="form-panel">
          <span className="sample-chip">Preview · Nothing is saved</span>
          <form onSubmit={submit} onChange={() => setFeedback(null)}>
            <h2>Item details</h2>
            <label>
              Item title
              <input
                name="title"
                maxLength={160}
                required
                placeholder="For example: Fujifilm X100V camera"
              />
            </label>
            <label>
              Category
              <select
                name="categoryId"
                aria-label="Category"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a category
                </option>
                {previewCategories.map((name, index) => (
                  <option
                    key={name}
                    value={`30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`}
                  >
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description
              <textarea
                name="description"
                rows={4}
                required
                placeholder="Condition, included accessories, and everything a buyer should know…"
              />
            </label>
            <p className="helper">
              This preview uses illustrations. Image uploads are not available
              yet.
            </p>
            <h2>Auction settings</h2>
            <div className="form-row">
              <label>
                Starting bid (VND)
                <input
                  name="openingPriceVnd"
                  type="text"
                  inputMode="numeric"
                  pattern="[1-9][0-9]*"
                  required
                  placeholder="1000000"
                />
              </label>
              <label>
                Bid increment (VND)
                <input
                  name="minimumIncrementVnd"
                  type="text"
                  inputMode="numeric"
                  pattern="[1-9][0-9]*"
                  required
                  placeholder="100000"
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Starts at
                <input name="startsAt" type="datetime-local" required />
              </label>
              <label>
                Ends at
                <input name="endsAt" type="datetime-local" required />
              </label>
            </div>
            <p className="helper">
              Enter times in your device time zone. The connected form sends ISO
              UTC timestamps to the server.
            </p>
            <button className="button" type="submit">
              Validate draft →
            </button>
            {feedback && (
              <p
                className={`notice ${feedback.error ? "notice-error" : ""}`}
                role={feedback.error ? "alert" : "status"}
              >
                {feedback.text}
              </p>
            )}
          </form>
        </section>
        <aside className="seller-guide">
          <p className="eyebrow">FROM DRAFT TO DISCOVERY</p>
          <ol>
            <li>
              <strong>Tell its story</strong>
              <p>Describe your item and choose a starting bid.</p>
            </li>
            <li>
              <strong>Review your draft</strong>
              <p>Make changes before publishing.</p>
            </li>
            <li>
              <strong>Publish your auction</strong>
              <p>
                After publishing, prices and schedules follow the auction rules.
              </p>
            </li>
          </ol>
          <p className="helper">
            The connected selling flow requires sign-in and server-side
            authorization.
          </p>
        </aside>
      </div>
    </>
  );
}
