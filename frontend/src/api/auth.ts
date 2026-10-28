import { useAuthStore } from "@/store/authStore";
import type { RegisterPayload, TokenPair, User } from "@/types/api";
import { http, refreshAccessToken } from "./client";

export async function login(username: string, password: string): Promise<TokenPair> {
  const { data } = await http.post<TokenPair>(
    "/auth/login/",
    { username, password },
    { skipAuth: true },
  );
  return data;
}

export async function register(payload: RegisterPayload): Promise<User> {
  const { data } = await http.post<User>("/auth/register/", payload, { skipAuth: true });
  return data;
}

export async function fetchMe(): Promise<User> {
  const { data } = await http.get<User>("/auth/me/");
  return data;
}

/** Log in and load the profile into the auth store. Throws the Axios error on failure. */
export async function signIn(username: string, password: string): Promise<User> {
  const { setTokens, setSession, logout } = useAuthStore.getState();
  const tokens = await login(username, password);
  setTokens(tokens.access, tokens.refresh); // interceptor needs the token before /me
  try {
    const user = await fetchMe();
    setSession(user, tokens.access, tokens.refresh);
    return user;
  } catch (err) {
    logout();
    throw err;
  }
}

/** Create an account, then sign straight in. */
export async function signUp(payload: RegisterPayload): Promise<User> {
  await register(payload);
  return signIn(payload.username, payload.password);
}

let restoring: Promise<void> | null = null;

/** On app start: turn the persisted refresh token back into a signed-in session (once). */
export function restoreSession(): Promise<void> {
  restoring ??= (async () => {
    const { refresh, setSession, setReady } = useAuthStore.getState();
    try {
      if (refresh) {
        const access = await refreshAccessToken();
        const user = await fetchMe();
        setSession(user, access, useAuthStore.getState().refresh ?? refresh);
      }
    } catch {
      useAuthStore.getState().logout(); // expired/invalid refresh token -> signed out
    } finally {
      setReady();
    }
  })();
  return restoring;
}

export function signOut(): void {
  useAuthStore.getState().logout();
}
