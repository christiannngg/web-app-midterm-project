/**
 * The seat a player claimed in one game: their socket token plus who they are.
 *
 * Kept in sessionStorage (per browser tab, gone when the tab closes), keyed by game code:
 *  - a page refresh keeps your seat instead of locking you out of your own nickname
 *  - two tabs in one browser can be two different players
 */
export interface PlayerSession {
  token: string;
  playerId: number;
  nickname: string;
}

const keyFor = (code: string) => `trivia-player:${code}`;

function isPlayerSession(v: unknown): v is PlayerSession {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.token === "string" && typeof o.playerId === "number" && typeof o.nickname === "string"
  );
}

// Storage can be unavailable (private mode, blocked cookies): fail soft, never throw.

export function loadPlayerSession(code: string): PlayerSession | null {
  try {
    const raw = window.sessionStorage.getItem(keyFor(code));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPlayerSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePlayerSession(code: string, session: PlayerSession): void {
  try {
    window.sessionStorage.setItem(keyFor(code), JSON.stringify(session));
  } catch {
    /* the player can still play this page load; a refresh will need a re-join */
  }
}

export function clearPlayerSession(code: string): void {
  try {
    window.sessionStorage.removeItem(keyFor(code));
  } catch {
    /* nothing to clear */
  }
}
