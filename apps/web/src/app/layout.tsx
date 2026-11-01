import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "../features/auth/session";
import { errorMessage } from "../lib/api-client";
export function AppShell({ preview = false }: { preview?: boolean }) {
  return (
    <AuthProvider preview={preview}>
      <Layout preview={preview} />
    </AuthProvider>
  );
}
function Layout({ preview }: { preview: boolean }) {
  const auth = useAuth();
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    window.scrollTo(0, 0);
    setLogoutError("");
    if (previousPath.current !== pathname) {
      document.getElementById("content")?.focus();
      previousPath.current = pathname;
    }
  }, [pathname]);
  const prefix = preview ? "/preview" : "";
  return (
    <>
      <a className="skip-link" href="#content">
        Skip to main content
      </a>
      <div className="preview-banner">
        <span className="preview-dot" />
        {preview ? (
          <>
            Preview / Sample data · No transactions{" "}
            <Link to="/auctions">Open the app →</Link>
          </>
        ) : (
          <>
            Discover, collect, and make your next great find.{" "}
            <Link to="/preview/auctions">View preview →</Link>
          </>
        )}
      </div>
      <header className="site-header">
        <div className="header-inner">
          <Link
            className="brand"
            to={`${prefix}/auctions`}
            aria-label="BIDHUB — Discover auctions"
          >
            <img
              className="brand-mark"
              src="/brand-mark.svg"
              alt=""
              aria-hidden="true"
            />
            BIDHUB
          </Link>
          <nav aria-label="Main navigation">
            <NavLink to={`${prefix}/auctions`} end>
              Discover
            </NavLink>
            <NavLink to={`${prefix}/auctions/new`}>Create auction</NavLink>
            <NavLink to={`${prefix}/dashboard`}>My auctions</NavLink>
          </nav>
          {!preview && auth.loading ? (
            <span className="helper" role="status">
              Checking your account…
            </span>
          ) : !preview && auth.user ? (
            <div className="account-menu">
              <Link to="/dashboard" className="account-name">
                {auth.user.displayName}
              </Link>
              <button
                className="button small secondary"
                disabled={loggingOut}
                onClick={async () => {
                  setLoggingOut(true);
                  setLogoutError("");
                  try {
                    await auth.logout();
                  } catch (error) {
                    setLogoutError(errorMessage(error));
                  } finally {
                    setLoggingOut(false);
                  }
                }}
              >
                {loggingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          ) : (
            <Link
              className="button small secondary login-link"
              to={`${prefix}/login`}
            >
              Sign in ↗
            </Link>
          )}
        </div>
      </header>
      {logoutError && (
        <p className="notice notice-error" role="alert">
          {logoutError}
        </p>
      )}
      <main id="content" className="page-shell" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <Link className="brand" to={`${prefix}/auctions`}>
          <img
            className="brand-mark"
            src="/brand-mark.svg"
            alt=""
            aria-hidden="true"
          />
          BIDHUB
        </Link>
        <p>Great finds. New possibilities.</p>
      </footer>
    </>
  );
}
