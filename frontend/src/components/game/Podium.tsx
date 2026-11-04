import type { Player } from "@/types/ws";

export interface PodiumProps {
  /** Final standings, best first. */
  players: Player[];
  selfId?: number | null;
}

const MEDALS = ["🥇", "🥈", "🥉"];

// Presentational (dumb) component: props in, JSX out, no data fetching.
export default function Podium({ players, selfId = null }: PodiumProps) {
  const top = players.slice(0, 3);
  const rest = players.slice(3);
  if (top.length === 0) return <p>Nobody played this game.</p>;
  return (
    <div className="podium-wrap">
      {/* Rank order in the DOM (for screen readers); CSS arranges 2nd - 1st - 3rd visually. */}
      <ol className="podium" aria-label="Top three">
        {top.map((player, i) => (
          <li key={player.id} className={`podium-place place-${i + 1}`}>
            <span className="medal" aria-hidden="true">
              {MEDALS[i]}
            </span>
            <span className="player-name">
              {player.nickname}
              {player.id === selfId ? " (you)" : ""}
            </span>
            <span className="score">{player.score}</span>
            <span className="sr-only">Place {i + 1}</span>
          </li>
        ))}
      </ol>
      {rest.length > 0 && (
        <>
          <h3>Everyone else</h3>
          <ol className="leaderboard" start={4} aria-label="Remaining players">
            {rest.map((player, i) => (
              <li key={player.id} className={player.id === selfId ? "player self" : "player"}>
                <span className="rank">{i + 4}</span>
                <span className="player-name">
                  {player.nickname}
                  {player.id === selfId ? " (you)" : ""}
                </span>
                <span className="score">{player.score}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
