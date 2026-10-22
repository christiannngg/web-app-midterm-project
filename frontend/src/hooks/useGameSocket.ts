import type { ClientMessage } from "@/types/ws";

/**
 * TODO: WebSocket hook.
 *  - connect to `${VITE_WS_URL}/game/${code}/?token=${access}`
 *  - parse each frame into ServerMessage (runtime-validate, no `any`) and dispatch to gameStore
 *  - expose { send(msg: ClientMessage), connectionState }
 *  - reconnect with exponential backoff; close cleanly on unmount
 */
export function useGameSocket(_code: string): { send: (msg: ClientMessage) => void } {
  return { send: () => undefined };
}
