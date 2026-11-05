import { Link } from "react-router-dom";
import type { GameHistoryItem } from "@/types/api";
import { formatDateTime, plural } from "@/utils/format";

interface Props {
  games: GameHistoryItem[];
}

/** Presentational: one card per finished game, newest first. */
export default function HistoryList({ games }: Props) {
  return (
    <ul className="quiz-list">
      {games.map((game) => (
        <li key={game.id} className="quiz-card">
          <div>
            <h2>{game.quiz_title}</h2>
            <p className="meta">
              <time dateTime={game.ended_at ?? undefined}>{formatDateTime(game.ended_at)}</time>
              {" · "}
              {plural(game.player_count, "player")}
              {" · "}
              {plural(game.question_count, "question")}
            </p>
            <p>
              {game.winner ? (
                <>
                  Winner: <strong>{game.winner.nickname}</strong> with {game.winner.score} points
                </>
              ) : (
                <span className="muted">Nobody played this game.</span>
              )}
            </p>
          </div>
          <Link className="button secondary" to={`/history/${game.code}`}>
            View results<span className="sr-only"> for {game.quiz_title}, game {game.code}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
