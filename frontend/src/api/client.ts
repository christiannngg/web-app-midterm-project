import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "@/store/authStore";
import { notify } from "@/store/toastStore";
import type { ApiErrorBody, TokenPair } from "@/types/api";
import { ERROR_MESSAGES, messageForStatus } from "./errors";

declare module "axios" {
  interface AxiosRequestConfig {
    /** Don't attach the bearer token or try to refresh on 401 (login, register, refresh). */
    skipAuth?: boolean;
    /**
     * The caller shows this request's errors itself (next to a form field, or as a message in
     * the page), so the interceptor must not also pop a toast for them.
     */
    inline?: boolean;
    _retried?: boolean;
  }
}

const baseURL = import.meta.env.VITE_API_URL;

export const http = axios.create({ baseURL });

// Request: attach `Authorization: Bearer <access>`.
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { access } = useAuthStore.getState();
  if (access && !config.skipAuth) config.headers.set("Authorization", `Bearer ${access}`);
  return config;
});

/**
 * True when the server answered "that token is no good" (400/401). Network failures and 5xx are
 * *not* a rejection: we don't know the token is bad, so the session must survive them (a host
 * whose Wi-Fi blinks must not be signed out).
 */
export function isAuthRejection(err: unknown): boolean {
  return (
    axios.isAxiosError(err) && (err.response?.status === 400 || err.response?.status === 401)
  );
}

// One refresh at a time: concurrent 401s all wait on the same request.
let refreshing: Promise<string> | null = null;

/** Exchange the stored refresh token for a new access token. Signs out only if it is rejected. */
export function refreshAccessToken(): Promise<string> {
  const { refresh, setTokens, logout } = useAuthStore.getState();
  if (!refresh) return Promise.reject(new Error("No refresh token"));
  refreshing ??= axios
    .post<Partial<TokenPair> & { access: string }>(`${baseURL}/auth/refresh/`, { refresh })
    .then(({ data }) => {
      setTokens(data.access, data.refresh);
      return data.access;
    })
    .catch((err: unknown) => {
      if (isAuthRejection(err)) logout();
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Milliseconds until a JWT expires (0 if it can't be read). Only used to decide when to refresh. */
function tokenLifeMs(jwt: string): number {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return 0;
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof claims === "object" && claims !== null && "exp" in claims) {
      const exp = claims.exp;
      if (typeof exp === "number") return exp * 1000 - Date.now();
    }
  } catch {
    /* unreadable token: treat as expired and refresh */
  }
  return 0;
}

const MIN_TOKEN_LIFE_MS = 30_000;

/** An access token that will still be valid when it reaches the server (used to open sockets). */
export async function getValidAccessToken(): Promise<string> {
  const { access } = useAuthStore.getState();
  if (access && tokenLifeMs(access) > MIN_TOKEN_LIFE_MS) return access;
  return refreshAccessToken();
}

function isApiErrorBody(data: unknown): data is ApiErrorBody {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as Record<string, unknown>).detail === "string" &&
    typeof (data as Record<string, unknown>).code === "string"
  );
}

/** HTTP status of a failed request, or null when there was no response (offline, CORS, timeout). */
export function getErrorStatus(err: unknown): number | null {
  return axios.isAxiosError(err) ? (err.response?.status ?? null) : null;
}

/** Always returns the shared error envelope, even for network failures or non-JSON bodies. */
export function normalizeError(err: unknown): ApiErrorBody {
  if (axios.isAxiosError(err)) {
    const data: unknown = err.response?.data;
    if (isApiErrorBody(data)) return data;
    if (!err.response) return { code: "network_error", detail: ERROR_MESSAGES.network };
    return { code: "http_error", detail: messageForStatus(err.response.status) };
  }
  return { code: "unknown_error", detail: ERROR_MESSAGES.unknown };
}

/** Blob downloads fail with the JSON error envelope as a Blob: turn it back into an object. */
async function unwrapBlobError(error: AxiosError): Promise<void> {
  const data: unknown = error.response?.data;
  if (error.response && data instanceof Blob) {
    try {
      error.response.data = JSON.parse(await data.text());
    } catch {
      error.response.data = undefined;
    }
  }
}

/**
 * Tell the user about a failed request, unless the caller is showing it itself (`inline`).
 *   400 with field errors  -> nothing: the form shows them next to the inputs
 *   400 otherwise, 403, 404, 429, 5xx, no response -> a toast
 *   401 -> only reaches here once a token refresh has failed, so the session is over
 */
function reportError(error: AxiosError): void {
  const config = error.config;
  if (config?.inline) return;
  const status = error.response?.status;
  if (status === 401) {
    if (!config?.skipAuth) notify.error(ERROR_MESSAGES.sessionExpired);
    return; // skipAuth 401 = wrong password: the sign-in form says so
  }
  const body = normalizeError(error);
  if (status === 400 && Object.keys(body.fields ?? {}).length > 0) return;
  notify.error(status === 400 ? body.detail : messageForStatus(status));
}

// Response: on 401, refresh once and replay the request; otherwise report and pass it through.
http.interceptors.response.use(
  (res) => res,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) throw error;
    await unwrapBlobError(error);
    const original = error.config;
    if (error.response?.status === 401 && original && !original.skipAuth && !original._retried) {
      original._retried = true;
      let access: string;
      try {
        access = await refreshAccessToken();
      } catch (refreshError: unknown) {
        // Rejected refresh token = signed out (the route guards send them to /login).
        // Anything else (offline, 5xx) is reported as what it is; the session is kept.
        if (axios.isAxiosError(refreshError) && !isAuthRejection(refreshError)) {
          reportError(refreshError);
        } else {
          reportError(error);
        }
        throw error;
      }
      original.headers.set("Authorization", `Bearer ${access}`);
      return http(original); // a failure of the replay is reported by its own pass through here
    }
    reportError(error);
    throw error;
  },
);
