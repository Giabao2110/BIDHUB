import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { safeReturnTo, useAuth } from "./session";
import { errorMessage } from "../../lib/api-client";
export function Login({ register = false }: { register?: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const returnTo = safeReturnTo(params.get("returnTo"));
  if (auth.user && !auth.error) return <Navigate to={returnTo} replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const values = new FormData(event.currentTarget);
    const password = String(values.get("password"));
    const displayName = String(values.get("displayName") ?? "").trim();
    if (register && !displayName) {
      setError("Please enter a display name.");
      return;
    }
    if (register && password !== values.get("confirmPassword")) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await auth.authenticate(register ? "/auth/register" : "/auth/login", {
        email: String(values.get("email")).trim().toLowerCase(),
        password,
        ...(register ? { displayName } : {}),
      });
      navigate(returnTo, { replace: true });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
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
        <p>One account to create, follow, and take part in auctions.</p>
        <Link className="text-link" to="/auctions">
          ← Keep exploring
        </Link>
      </section>
      <section className="form-panel">
        <h2>{register ? "Create an account" : "Sign in"}</h2>
        <p className="muted">
          {register
            ? "Your next great find starts here."
            : "Welcome back. Your next discovery awaits."}
        </p>
        {!!auth.error && (
          <p className="notice" role="status">
            We could not restore your session. Try signing in again. Sample data
            is only available in the preview.
          </p>
        )}
        <form
          key={register ? "register" : "login"}
          onSubmit={submit}
          onChange={() => setError("")}
        >
          <fieldset disabled={pending}>
            {register && (
              <label>
                Display name
                <input
                  name="displayName"
                  autoComplete="nickname"
                  maxLength={80}
                  required
                />
              </label>
            )}
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={register ? 8 : undefined}
                maxLength={256}
                aria-describedby={register ? "password-help" : undefined}
              />
            </label>
            {register && (
              <>
                <p id="password-help" className="helper">
                  Use at least 8 characters. The server checks the final
                  password requirements.
                </p>
                <label>
                  Confirm password
                  <input
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                </label>
              </>
            )}
            <button className="button full" type="submit">
              {pending ? "Working…" : register ? "Create account" : "Sign in"}
            </button>
          </fieldset>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
        </form>
        <p className="helper">
          Your session uses a cookie. Your password is not stored in the
          browser.
        </p>
        <Link
          className="text-link"
          to={`${register ? "/login" : "/register"}?returnTo=${encodeURIComponent(returnTo)}`}
          onClick={() => setError("")}
        >
          {register
            ? "Already have an account? Sign in"
            : "New to BIDHUB? Create an account"}
        </Link>
      </section>
    </div>
  );
}
