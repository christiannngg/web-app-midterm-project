import axios, {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";
import { ERROR_MESSAGES } from "./errors";
import { getErrorStatus, http, normalizeError } from "./client";

type Reply = { status: number; data?: unknown } | "network-error";
type Handler = (config: InternalAxiosRequestConfig) => Reply;

/** Replace the network: every request goes to `handler`, and `calls` records what was sent. */
function fakeNetwork(handler: Handler) {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = (config) => {
    calls.push(config);
    const reply = handler(config);
    if (reply === "network-error") {
      return Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config));
    }
    const response: AxiosResponse = {
      data: reply.data ?? {},
      status: reply.status,
      statusText: "",
      headers: {},
      config,
    };
    if (reply.status >= 200 && reply.status < 300) return Promise.resolve(response);
    return Promise.reject(
      new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, response),
    );
  };
  http.defaults.adapter = adapter;
  axios.defaults.adapter = adapter; // token refresh uses plain axios
  return calls;
}

const toastMessages = () => useToastStore.getState().toasts.map((t) => t.message);
const envelope = (code: string, detail: string, fields?: Record<string, string[]>) => ({
  code,
  detail,
  ...(fields ? { fields } : {}),
});

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the request to fail");
}

describe("api client", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    useAuthStore.setState({ user: null, access: null, refresh: null, ready: true });
  });

  it("attaches the bearer token, except for skipAuth requests", async () => {
    useAuthStore.setState({ access: "tok" });
    const calls = fakeNetwork(() => ({ status: 200 }));
    await http.get("/things/");
    await http.post("/auth/login/", {}, { skipAuth: true });
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer tok");
    expect(calls[1]?.headers.get("Authorization")).toBeFalsy();
  });

  describe("error reporting", () => {
    it("403 -> toast", async () => {
      fakeNetwork(() => ({ status: 403, data: envelope("permission_denied", "No.") }));
      await failure(http.get("/x/"));
      expect(toastMessages()).toEqual([ERROR_MESSAGES.forbidden]);
    });

    it("404 -> toast", async () => {
      fakeNetwork(() => ({ status: 404, data: envelope("not_found", "No.") }));
      await failure(http.get("/x/"));
      expect(toastMessages()).toEqual([ERROR_MESSAGES.notFound]);
    });

    it("500 -> toast, even when the body isn't JSON", async () => {
      fakeNetwork(() => ({ status: 500, data: "<html>boom</html>" }));
      await failure(http.get("/x/"));
      expect(toastMessages()).toEqual([ERROR_MESSAGES.server]);
    });

    it("no response at all -> 'can't reach the server' toast", async () => {
      fakeNetwork(() => "network-error");
      await failure(http.get("/x/"));
      expect(toastMessages()).toEqual([ERROR_MESSAGES.network]);
    });

    it("400 with field errors -> no toast (the form shows them next to the inputs)", async () => {
      fakeNetwork(() => ({
        status: 400,
        data: envelope("validation_error", "Fix.", { title: ["Required."] }),
      }));
      await failure(http.post("/quizzes/", {}));
      expect(toastMessages()).toEqual([]);
    });

    it("400 without fields -> toast with the server's message", async () => {
      fakeNetwork(() => ({ status: 400, data: envelope("bad", "Lobby is locked.") }));
      await failure(http.post("/x/", {}));
      expect(toastMessages()).toEqual(["Lobby is locked."]);
    });

    it("inline requests are never toasted", async () => {
      fakeNetwork(() => ({ status: 500 }));
      await failure(http.get("/x/", { inline: true }));
      expect(toastMessages()).toEqual([]);
    });
  });

  describe("401 handling", () => {
    it("refreshes the token once and replays the request with the new one", async () => {
      useAuthStore.setState({ access: "old", refresh: "refresh-1" });
      const calls = fakeNetwork((config) => {
        if (config.url?.endsWith("/auth/refresh/")) return { status: 200, data: { access: "new" } };
        return config.headers.get("Authorization") === "Bearer new"
          ? { status: 200, data: { ok: true } }
          : { status: 401, data: envelope("token_not_valid", "Expired.") };
      });

      const res = await http.get("/things/");

      expect(res.data).toEqual({ ok: true });
      expect(calls.map((c) => c.url)).toEqual(["/things/", "http://api.test/api/auth/refresh/", "/things/"]);
      expect(useAuthStore.getState().access).toBe("new");
      expect(toastMessages()).toEqual([]);
    });

    it("signs out and says so when the refresh token is rejected", async () => {
      useAuthStore.setState({
        user: { id: 1, username: "h", role: "host" },
        access: "old",
        refresh: "dead",
      });
      fakeNetwork((config) =>
        config.url?.endsWith("/auth/refresh/")
          ? { status: 401, data: envelope("token_not_valid", "Dead.") }
          : { status: 401, data: envelope("token_not_valid", "Expired.") },
      );

      await failure(http.get("/things/"));

      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().refresh).toBeNull();
      expect(toastMessages()).toEqual([ERROR_MESSAGES.sessionExpired]);
    });

    it("keeps the session when the refresh fails only because the network is down", async () => {
      useAuthStore.setState({
        user: { id: 1, username: "h", role: "host" },
        access: "old",
        refresh: "fine",
      });
      fakeNetwork((config) =>
        config.url?.endsWith("/auth/refresh/")
          ? "network-error"
          : { status: 401, data: envelope("token_not_valid", "Expired.") },
      );

      await failure(http.get("/things/"));

      expect(useAuthStore.getState().user?.username).toBe("h");
      expect(useAuthStore.getState().refresh).toBe("fine");
      expect(toastMessages()).toEqual([ERROR_MESSAGES.network]);
    });

    it("a wrong password (skipAuth 401) is left for the form: no refresh, no toast", async () => {
      const calls = fakeNetwork(() => ({
        status: 401,
        data: envelope("no_active_account", "Bad credentials."),
      }));
      await failure(http.post("/auth/login/", {}, { skipAuth: true, inline: true }));
      expect(calls).toHaveLength(1);
      expect(toastMessages()).toEqual([]);
    });
  });

  describe("normalizeError / getErrorStatus", () => {
    it("passes the server envelope through", async () => {
      fakeNetwork(() => ({ status: 409, data: envelope("game_not_finished", "Not yet.") }));
      const err = await failure(http.get("/x/", { inline: true }));
      expect(normalizeError(err)).toEqual({ code: "game_not_finished", detail: "Not yet." });
      expect(getErrorStatus(err)).toBe(409);
    });

    it("builds an envelope when the body isn't one", async () => {
      fakeNetwork(() => ({ status: 502, data: "bad gateway" }));
      const err = await failure(http.get("/x/", { inline: true }));
      expect(normalizeError(err)).toEqual({ code: "http_error", detail: ERROR_MESSAGES.server });
    });

    it("handles network failures and non-HTTP errors", async () => {
      fakeNetwork(() => "network-error");
      const err = await failure(http.get("/x/", { inline: true }));
      expect(normalizeError(err).code).toBe("network_error");
      expect(getErrorStatus(err)).toBeNull();
      expect(normalizeError(new Error("???")).code).toBe("unknown_error");
    });
  });
});
