import axios, { type InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "@/store/authStore";
import type { ApiErrorBody, TokenPair } from "@/types/api";

declare module "axios" {
  interface AxiosRequestConfig {
    /** Don't attach the bearer token or try to refresh on 401 (login, register, refresh). */
    skipAuth?: boolean;
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

// One refresh at a time: concurrent 401s all wait on the same request.
let refreshing: Promise<string> | null = null;

/** Exchange the stored refresh token for a new access token. Rejects (and logs out) on failure. */
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
      logout();
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// Response: on 401, refresh once and replay the request; otherwise pass the error through.
http.interceptors.response.use(
  (res) => res,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) throw error;
    const original = error.config;
    if (error.response?.status === 401 && original && !original.skipAuth && !original._retried) {
      original._retried = true;
      const access = await refreshAccessToken(); // throws -> caller sees the failure
      original.headers.set("Authorization", `Bearer ${access}`);
      return http(original);
    }
    // TODO (Phase 5): surface 403/404/500 as toasts here.
    throw error;
  },
);

function isApiErrorBody(data: unknown): data is ApiErrorBody {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as Record<string, unknown>).detail === "string" &&
    typeof (data as Record<string, unknown>).code === "string"
  );
}

/** Always returns the shared error envelope, even for network failures or non-JSON bodies. */
export function normalizeError(err: unknown): ApiErrorBody {
  if (axios.isAxiosError(err)) {
    const data: unknown = err.response?.data;
    if (isApiErrorBody(data)) return data;
    if (!err.response) {
      return { code: "network_error", detail: "Can't reach the server. Check your connection." };
    }
  }
  return { code: "unknown_error", detail: "Something went wrong. Please try again." };
}
