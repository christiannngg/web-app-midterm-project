// Presentational (dumb) component: props in, JSX out, no data fetching.
// TODO: replace Record<string, never> with the real props interface.
export type PlayerListProps = Record<string, never>;

export default function PlayerList(_props: PlayerListProps) {
  return null;
}
