import type { Player } from "@/types/ws";

export interface LeaderboardProps {
  players: Player[];
  /** Highlights this player's row. */
  selfId?: number | null;
  /** Points each player earned on the last question, shown as "+850". */
  awarded?: Record<number, number>;
  /** Show only the top N (default: everyone). */
  limit?: number;
}

// Presentational (dumb) component: props in, JSX out, no data fetching.
export default function Leaderboard({ players, selfId = null, awarded, limit }: LeaderboardProps) {
  const rows = limit ? players.slice(0, limit) : players;
  if (rows.length === 0) return null;
  return (
    <ol className="leaderboard" aria-label="Leaderboard">
      {rows.map((player, i) => {
        const gained = awarded?.[player.id] ?? 0;
        return (
          <li key={player.id} className={player.id === selfId ? "player self" : "player"}>
            <span className="rank">{i + 1}</span>
            <span className="player-name">
              {player.nickname}
              {player.id === selfId ? " (you)" : ""}
            </span>
            <span className="score">
              {gained > 0 && <span className="gain">+{gained} </span>}
              {player.score}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
