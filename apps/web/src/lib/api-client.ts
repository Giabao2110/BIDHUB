import type { ApiError } from "@bidhub/contracts";
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}
const messages: Record<string, string> = {
  UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  ACCOUNT_DISABLED:
    "This account has been disabled. Please contact an administrator.",
  EMAIL_EXISTS: "This email is already in use.",
  INVALID_CREDENTIALS: "Incorrect email or password.",
  INVALID_CSRF: "Your form security token has expired. Please try again.",
  CSRF_INVALID: "Your form security token has expired. Please try again.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NOT_FOUND: "This resource was not found, or this API is not available yet.",
};
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const message =
      messages[error.code] ??
      (error.status === 401
        ? "Incorrect email or password."
        : error.status === 409
          ? "The auction data or status has changed. Reload before continuing."
          : error.status === 422
            ? "Some details are invalid. Please check the form."
            : error.status === 429
              ? "Too many requests. Please try again later."
              : "Unable to complete the request. Please try again.");
    return error.requestId
      ? `${message} Request ID: ${error.requestId}`
      : message;
  }
  return "Unable to reach the server. Check your connection and try again.";
}
export async function apiRequest<T>(
  path: string,
  options: RequestInit & { csrfToken?: string } = {},
): Promise<T> {
  const { csrfToken, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as ApiError | null;
    throw new ApiRequestError(
      response.status,
      payload?.error?.code ?? "HTTP_ERROR",
      payload?.error?.message ?? "Unable to complete the request.",
      payload?.error?.requestId,
    );
  }
  if (response.status === 204) return undefined as T;
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new ApiRequestError(
      502,
      "INVALID_RESPONSE",
      "The API returned an invalid response.",
    );
  }
  return response.json() as Promise<T>;
}

/** Fetch a fresh CSRF token for each user-initiated write. Never auto-retry a mutation. */
export async function apiWrite<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>("/auth/csrf", {
    cache: "no-store",
  });
  if (!csrfToken)
    throw new ApiRequestError(502, "INVALID_RESPONSE", "Missing CSRF token.");
  return apiRequest<T>(path, {
    method,
    csrfToken,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
