import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useLocation } from "react-router-dom";
import {
  apiRequest,
  ApiRequestError,
  apiWrite,
  errorMessage,
} from "../../lib/api-client";
import type { User } from "../../lib/models";

const sessionKey = ["session"];
function useSessionQuery(enabled: boolean) {
  return useQuery({
    queryKey: sessionKey,
    enabled,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        return (
          await apiRequest<{ user: User }>("/auth/me", {
            signal,
            cache: "no-store",
          })
        ).user;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401)
          return null;
        throw error;
      }
    },
  });
}
const AuthContext = createContext<{
  user: User | null;
  loading: boolean;
  error: unknown;
  refresh: () => Promise<unknown>;
  authenticate: (
    path: "/auth/login" | "/auth/register",
    input: unknown,
  ) => Promise<void>;
  logout: () => Promise<void>;
} | null>(null);

export function AuthProvider({
  children,
  preview = false,
}: {
  children: ReactNode;
  preview?: boolean;
}) {
  const query = useSessionQuery(!preview);
  const client = useQueryClient();
  // Private queries are removed before resolving a new identity, including cross-tab changes.
  useEffect(() => {
    if (preview) return;
    const synchronize = () => {
      client.setQueryData(sessionKey, null);
      void client.cancelQueries({ queryKey: ["private"] });
      client.removeQueries({ queryKey: ["private"] });
      void query.refetch();
    };
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("bidhub-auth")
        : null;
    if (channel) channel.onmessage = synchronize;
    return () => {
      channel?.close();
    };
  }, [preview, client]);
  const notify = () => {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("bidhub-auth");
      channel.postMessage("changed");
      channel.close();
    }
  };
  const clearPrivate = async () => {
    await client.cancelQueries({ queryKey: ["private"] });
    client.removeQueries({ queryKey: ["private"] });
  };
  return (
    <AuthContext.Provider
      value={{
        user: preview ? null : (query.data ?? null),
        loading: !preview && query.isPending,
        error: preview ? null : query.error,
        refresh: () => query.refetch(),
        authenticate: async (path, input) => {
          await client.cancelQueries({ queryKey: sessionKey });
          const { user } = await apiWrite<{ user: User }>(path, "POST", input);
          await clearPrivate();
          await client.cancelQueries({ queryKey: sessionKey });
          client.setQueryData(sessionKey, user);
          notify();
        },
        logout: async () => {
          try {
            await apiWrite<void>("/auth/logout", "POST");
          } catch (error) {
            if (!(error instanceof ApiRequestError && error.status === 401))
              throw error;
          }
          await clearPrivate();
          await client.cancelQueries({ queryKey: sessionKey });
          client.setQueryData(sessionKey, null);
          notify();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("AuthProvider missing");
  return auth;
}
export function safeReturnTo(value: string | null) {
  if (
    !value ||
    !/^\/(?:dashboard|auctions(?:\/[^?#]*)?)(?:\?[^#]*)?$/.test(value) ||
    value.includes("\\")
  )
    return "/dashboard";
  return value;
}
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading)
    return (
      <p role="status" className="notice">
        Restoring your session…
      </p>
    );
  if (auth.error)
    return (
      <section className="state-panel">
        <h1>Unable to verify your account</h1>
        <p role="alert">{errorMessage(auth.error)}</p>
        <button className="button" onClick={() => void auth.refresh()}>
          Try again
        </button>
        <Link className="text-link" to="/login">
          Go to sign in
        </Link>
      </section>
    );
  if (!auth.user)
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  return children;
}
