import { create } from "zustand";

export type ToastKind = "error" | "success" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

/** How long each kind stays up. Errors linger longer: people need time to read what went wrong. */
const DURATION_MS: Record<ToastKind, number> = { error: 7000, success: 4000, info: 4000 };
const MAX_VISIBLE = 4;

interface ToastState {
  toasts: Toast[];
  show: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const timers = new Map<number, number>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: (kind, message) => {
    // The same message already on screen (say, five requests failing at once): don't stack copies.
    if (get().toasts.some((t) => t.kind === kind && t.message === message)) return;
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-(MAX_VISIBLE - 1)), { id, kind, message }] }));
    timers.set(
      id,
      window.setTimeout(() => get().dismiss(id), DURATION_MS[kind]),
    );
  },

  dismiss: (id) => {
    window.clearTimeout(timers.get(id));
    timers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** For code outside React (the axios interceptor, the socket hook): `notify.error("...")`. */
export const notify = {
  error: (message: string) => useToastStore.getState().show("error", message),
  success: (message: string) => useToastStore.getState().show("success", message),
  info: (message: string) => useToastStore.getState().show("info", message),
};
