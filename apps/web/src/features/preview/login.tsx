import { useState, type FormEvent } from "react";
import { PreviewLink as Link } from "../../app/preview-link";
export function Login() {
  const [message, setMessage] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(
      "The form is valid. Nothing was sent: sign-in is not connected in this preview.",
    );
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">WELCOME TO BIDHUB</p>
        <h1>
          Your next great find
          <br />
          is waiting for <em>you.</em>
        </h1>
        <p>
          One account to sell, follow your favorite finds, and take part in
          auctions.
        </p>
        <div className="auth-outline">
          <span>01</span>
          <p>Discover something special</p>
          <span>02</span>
          <p>Choose your bid</p>
          <span>03</span>
          <p>Follow every final moment</p>
        </div>
      </section>
      <section className="form-panel">
        <span className="sample-chip">Preview · Sign-in not connected</span>
        <h2>Sign in</h2>
        <p className="muted">Welcome back. Your next discovery awaits.</p>
        <form onSubmit={submit} onChange={() => setMessage("")}>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              aria-describedby="login-note"
            />
          </label>
          <p id="login-note" className="helper">
            This preview only validates the form. It does not sign you in or
            store your password.
          </p>
          <button className="button full" type="submit">
            Validate form →
          </button>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
        </form>
        <p className="helper">
          Account registration and session restoration are not connected in this
          preview.
        </p>
        <Link className="text-link" to="/auctions">
          ← Keep exploring
        </Link>
      </section>
    </div>
  );
}
