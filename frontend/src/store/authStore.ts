import { create } from "zustand";
import type { User } from "@/types/api";

interface AuthState {
  user: User | null;
  access: string | null;
  refresh: string | null;
  setSession: (user: User, access: string, refresh: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  access: null,
  refresh: null,
  setSession: (user, access, refresh) => set({ user, access, refresh }),
  logout: () => set({ user: null, access: null, refresh: null }),
}));
// TODO: persist refresh token (zustand/middleware persist) with care
