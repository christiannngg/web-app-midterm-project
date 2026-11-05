import type { StandingRow } from "@/types/api";

interface Props {
  standings: StandingRow[];
  questionCount: number;
}

/** Presentational: final standings as a real table, so screen readers get row/column headers. */
export default function StandingsTable({ standings, questionCount }: Props) {
  if (standings.length === 0) return <p className="muted">Nobody played this game.</p>;
  return (
    <table className="results-table">
      <caption className="sr-only">Final standings</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Player</th>
          <th scope="col" className="num">
            Score
          </th>
          <th scope="col" className="num">
            Correct
          </th>
        </tr>
      </thead>
      <tbody>
        {standings.map((row) => (
          <tr key={row.player_id}>
            <td>{row.rank}</td>
            <th scope="row">{row.nickname}</th>
            <td className="num">{row.score}</td>
            <td className="num">
              {row.correct_count} of {questionCount}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
