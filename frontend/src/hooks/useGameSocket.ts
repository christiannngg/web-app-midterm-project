import { useCallback, useEffect, useRef } from "react";
import { useGameStore } from "@/store/gameStore";
import { CLOSE_CODE, type ClientMessage, type ConnectionState } from "@/types/ws";
import { parseServerMessage } from "@/utils/parseServerMessage";

function stateAfterClose(code: number): ConnectionState {
  if (code === CLOSE_CODE.KICKED) return "kicked";
  if (
    code === CLOSE_CODE.UNAUTHORIZED ||
    code === CLOSE_CODE.FORBIDDEN ||
    code === CLOSE_CODE.NOT_FOUND
  ) {
    return "rejected";
  }
  return "closed";
}

/**
 * Open the socket for one game and feed every server message into the game store.
 *
 *  - `token` is the host's JWT or the player token from `joinGame`; `null` means "don't connect yet".
 *  - Changing `code` or `token` closes the old socket and starts from a clean store, so one
 *    game's state can never leak into the next.
 *  - Pass a *stable* token: a new value reconnects. (HostPage captures its JWT once for this.)
 *
 * Phase 5 adds reconnect with backoff; for now a dropped socket stays "closed".
 */
export function useGameSocket(
  code: string,
  token: string | null,
): { send: (msg: ClientMessage) => void; connectionState: ConnectionState } {
  const socketRef = useRef<WebSocket | null>(null);
  const connectionState = useGameStore((s) => s.connection);

  useEffect(() => {
    const { reset, setConnection, apply } = useGameStore.getState();
    reset();
    if (!token) return;

    setConnection("connecting");
    const url = `${import.meta.env.VITE_WS_URL}/game/${code}/?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => setConnection("open");
    ws.onmessage = (event: MessageEvent<unknown>) => {
      const message = parseServerMessage(event.data);
      if (message) apply(message);
    };
    // `onerror` carries no detail and is always followed by `onclose`, which has the code.
    ws.onclose = (event) => setConnection(stateAfterClose(event.code), event.code);

    return () => {
      // Silence the old socket first so a late event can't overwrite the new game's state.
      ws.onopen = ws.onmessage = ws.onclose = null;
      ws.close();
      if (socketRef.current === ws) socketRef.current = null;
    };
  }, [code, token]);

  const send = useCallback((message: ClientMessage) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  return { send, connectionState };
}
