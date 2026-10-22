// Presentational (dumb) component: props in, JSX out, no data fetching.
// TODO: replace Record<string, never> with the real props interface.
export type CountdownBarProps = Record<string, never>;

export default function CountdownBar(_props: CountdownBarProps) {
  return null;
}
