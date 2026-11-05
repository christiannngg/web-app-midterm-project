import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "./authStore";

describe("authStore", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, access: null, refresh: null, ready: false });
    window.localStorage.clear();
  });

  it("setSession stores the user and both tokens", () => {
    useAuthStore.getState().setSession({ id: 1, username: "h", role: "host" }, "a", "r");
    const s = useAuthStore.getState();
    expect(s.user?.username).toBe("h");
    expect(s.access).toBe("a");
    expect(s.refresh).toBe("r");
  });

  it("setTokens keeps the old refresh token when the server didn't rotate it", () => {
    useAuthStore.getState().setSession({ id: 1, username: "h", role: "host" }, "a", "r");
    useAuthStore.getState().setTokens("a2");
    expect(useAuthStore.getState().access).toBe("a2");
    expect(useAuthStore.getState().refresh).toBe("r");
  });

  it("only the refresh token is written to localStorage", () => {
    useAuthStore.getState().setSession({ id: 1, username: "h", role: "host" }, "secret-access", "r");
    const saved = window.localStorage.getItem("trivia-auth") ?? "";
    expect(saved).toContain('"refresh":"r"');
    expect(saved).not.toContain("secret-access");
    expect(saved).not.toContain('"username"');
  });

  it("logout clears everything", () => {
    useAuthStore.getState().setSession({ id: 1, username: "h", role: "host" }, "a", "r");
    useAuthStore.getState().logout();
    const s = useAuthStore.getState();
    expect([s.user, s.access, s.refresh]).toEqual([null, null, null]);
  });
});
