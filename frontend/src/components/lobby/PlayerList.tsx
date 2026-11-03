import type { LobbyPlayer } from "@/types/ws";

export interface PlayerListProps {
  players: LobbyPlayer[];
  /** Id of the viewer's own player, to mark "(you)". Omit on the host screen. */
  selfId?: number | null;
  /** Host only: renders a Kick button per player. */
  onKick?: (player: LobbyPlayer) => void;
}

// Presentational (dumb) component: props in, JSX out, no data fetching.
export default function PlayerList({ players, selfId, onKick }: PlayerListProps) {
  if (players.length === 0) {
    return <p className="muted">No players yet. Share the code above.</p>;
  }
  return (
    <ul className="player-list" aria-label="Players in this lobby">
      {players.map((player) => (
        <li key={player.id} className={player.connected ? "player" : "player offline"}>
          <span className="player-name">
            {player.nickname}
            {player.id === selfId && <span className="muted"> (you)</span>}
          </span>
          {!player.connected && <span className="badge">Offline</span>}
          {onKick && (
            <button type="button" className="danger" onClick={() => onKick(player)}>
              Kick<span className="sr-only"> {player.nickname}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
