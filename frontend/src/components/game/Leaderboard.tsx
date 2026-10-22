// Presentational (dumb) component: props in, JSX out, no data fetching.
// TODO: replace Record<string, never> with the real props interface.
export type LeaderboardProps = Record<string, never>;

export default function Leaderboard(_props: LeaderboardProps) {
  return null;
}
