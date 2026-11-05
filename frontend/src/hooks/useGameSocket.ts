import { useCallback, useEffect, useRef } from "react";
import { useGameStore } from "@/store/gameStore";
import { notify } from "@/store/toastStore";
import { CLOSE_CODE, type ClientMessage, type ConnectionState } from "@/types/ws";
import { parseServerMessage } from "@/utils/parseServerMessage";

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 15_000;
/** How often we ping, and how long total silence (not even a PONG) means the link is dead. */
const HEARTBEAT_MS = 10_000;
const STALE_AFTER_MS = 25_000;

const PING_FRAME = JSON.stringify({ type: "PING", payload: {} } satisfies ClientMessage);

/**
 * Wait before reconnect attempt number `attempt` (0, 1, 2, ...): 1 s, 2 s, 4 s ... capped at 15 s,
 * with "equal jitter" (somewhere between half and all of that) so a room full of players who lost
 * the same Wi-Fi don't all hammer the server in the same instant when it comes back.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/** Close codes where the server *refused* us, so retrying is pointless. Anything else is retried. */
function refusalFor(code: number): "kicked" | "rejected" | null {
  if (code === CLOSE_CODE.KICKED) return "kicked";
  if (
    code === CLOSE_CODE.UNAUTHORIZED ||
    code === CLOSE_CODE.FORBIDDEN ||
    code === CLOSE_CODE.NOT_FOUND
  ) {
    return "rejected";
  }
  return null;
}

export interface GameSocketOptions {
  /**
   * Returns a token that is still valid. Called before every reconnect, and once more if the
   * server answers 4401, because a host's JWT lives 15 minutes and the game may outlast it.
   * Players don't need it: their token is good for the whole lobby. Pass a *stable* function.
   */
  refreshToken?: () => Promise<string>;
}

/**
 * Open the socket for one game and feed every server message into the game store.
 *
 *  - `token` is the host's JWT or the player token from `joinGame`; `null` means "don't connect yet".
 *  - Changing `code` or `token` closes the old socket and starts from a clean store, so one
 *    game's state can never leak into the next.
 *  - Pass a *stable* token: a new value reconnects. (HostPage captures its JWT once for this.)
 *
 * When the connection drops (Wi-Fi gone, laptop asleep, server restarted) the hook keeps the
 * game on screen, switches to "reconnecting" and retries with exponential backoff until it is
 * back or the server refuses it. A fresh socket is sent the current question/results by the
 * server, so nothing here needs to remember what was on screen. It stops for good when the
 * server refuses us (kicked, bad token, unknown game) or once the game has finished.
 *
 * Three signals notice a dead link: the socket's own close event, the browser's offline event,
 * and a heartbeat (a connection that silently half-dies never fires a close event).
 */
export function useGameSocket(
  code: string,
  token: string | null,
  options: GameSocketOptions = {},
): { send: (msg: ClientMessage) => boolean; connectionState: ConnectionState; reconnectNow: () => void } {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectNowRef = useRef<() => void>(() => undefined);
  const connectionState = useGameStore((s) => s.connection);
  const { refreshToken } = options;

  useEffect(() => {
    const { reset, setConnection, apply } = useGameStore.getState();
    reset();
    if (!token) return;

    let disposed = false;
    let socket: WebSocket | null = null;
    let currentToken = token;
    let attempt = 0;
    let hasBeenOpen = false;
    let refreshedAfter401 = false;
    let lastHeardAt = 0;
    let retryTimer: number | undefined;
    let heartbeatTimer: number | undefined;

    /** Let go of the current socket so none of its late events can reach us. */
    const detach = () => {
      window.clearInterval(heartbeatTimer);
      const old = socket;
      socket = null;
      socketRef.current = null;
      if (!old) return;
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      old.close();
    };

    const startHeartbeat = () => {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = window.setInterval(() => {
        if (socket?.readyState !== WebSocket.OPEN) return;
        // Background tabs throttle timers, so only judge silence while the page is visible.
        if (!document.hidden && Date.now() - lastHeardAt > STALE_AFTER_MS) {
          detach();
          scheduleReconnect();
          return;
        }
        socket.send(PING_FRAME);
      }, HEARTBEAT_MS);
    };

    const connect = () => {
      if (disposed || socket) return;
      setConnection(hasBeenOpen || attempt > 0 ? "reconnecting" : "connecting");
      const url = `${import.meta.env.VITE_WS_URL}/game/${code}/?token=${encodeURIComponent(currentToken)}`;
      const ws = new WebSocket(url);
      socket = ws;
      socketRef.current = ws;

      ws.onopen = () => {
        const wasReconnect = hasBeenOpen;
        hasBeenOpen = true;
        attempt = 0;
        refreshedAfter401 = false;
        lastHeardAt = Date.now();
        setConnection("open");
        startHeartbeat();
        if (wasReconnect) notify.success("Back online.");
      };
      ws.onmessage = (event: MessageEvent<unknown>) => {
        lastHeardAt = Date.now();
        const message = parseServerMessage(event.data);
        if (message) apply(message);
      };
      // `onerror` carries no detail and is always followed by `onclose`, which has the code.
      ws.onclose = (event) => {
        detach();
        void handleClose(event.code);
      };
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      setConnection("reconnecting");
      const delay = backoffDelayMs(attempt);
      attempt += 1;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void reconnect(), delay);
    };

    /** Get a still-valid token (hosts), then open a new socket. */
    const reconnect = async () => {
      if (disposed || socket) return;
      if (refreshToken) {
        try {
          currentToken = await refreshToken();
        } catch {
          scheduleReconnect(); // can't get a token right now (offline): keep trying
          return;
        }
      }
      connect();
    };

    const handleClose = async (closeCode: number) => {
      if (closeCode === CLOSE_CODE.UNAUTHORIZED && refreshToken && !refreshedAfter401) {
        // The host's JWT probably expired while the socket was down: retry once with a new one.
        try {
          currentToken = await refreshToken();
          refreshedAfter401 = true;
        } catch {
          scheduleReconnect();
          return;
        }
        connect();
        return;
      }
      const refusal = refusalFor(closeCode);
      if (refusal) {
        setConnection(refusal, closeCode);
      } else if (useGameStore.getState().status === "FINISHED") {
        setConnection("closed", closeCode); // the game is over: nothing left to come back to
      } else {
        scheduleReconnect();
      }
    };

    /** "Try now" button and the browser's online event: skip whatever backoff is left. */
    const retryNow = () => {
      if (useGameStore.getState().connection !== "reconnecting" || socket) return;
      window.clearTimeout(retryTimer);
      attempt = 0;
      void reconnect();
    };
    reconnectNowRef.current = retryNow;

    const onOffline = () => {
      // The browser says the network is gone: don't wait for a TCP timeout to find out.
      if (!socket) return;
      detach();
      scheduleReconnect();
    };
    const onVisible = () => {
      // Back from a background tab: give the connection a fresh chance to prove it is alive.
      if (document.hidden || socket?.readyState !== WebSocket.OPEN) return;
      lastHeardAt = Date.now();
      socket.send(PING_FRAME);
    };
    window.addEventListener("online", retryNow);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);

    connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      detach();
      window.removeEventListener("online", retryNow);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      reconnectNowRef.current = () => undefined;
    };
  }, [code, token, refreshToken]);

  /** Returns false (and sends nothing) unless the socket is open, so callers can tell. */
  const send = useCallback((message: ClientMessage): boolean => {
    const ws = socketRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }, []);

  const reconnectNow = useCallback(() => reconnectNowRef.current(), []);

  return { send, connectionState, reconnectNow };
}
