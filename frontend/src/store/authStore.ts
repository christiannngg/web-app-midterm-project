import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types/api";

interface AuthState {
  user: User | null;
  /** Short-lived; kept in memory only. */
  access: string | null;
  /** Persisted so a page reload can silently sign back in. */
  refresh: string | null;
  /** False until the first restoreSession() attempt has finished. */
  ready: boolean;
  setTokens: (access: string, refresh?: string) => void;
  setSession: (user: User, access: string, refresh: string) => void;
  setReady: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      access: null,
      refresh: null,
      ready: false,
      // `refresh` is optional because the backend only rotates it on /auth/refresh/.
      setTokens: (access, refresh) =>
        set((s) => ({ access, refresh: refresh ?? s.refresh })),
      setSession: (user, access, refresh) => set({ user, access, refresh }),
      setReady: () => set({ ready: true }),
      logout: () => set({ user: null, access: null, refresh: null }),
    }),
    {
      name: "trivia-auth",
      // Only the refresh token touches localStorage; user + access are re-fetched.
      partialize: (s) => ({ refresh: s.refresh }),
    },
  ),
);
