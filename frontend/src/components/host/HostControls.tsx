// Presentational (dumb) component: props in, JSX out, no data fetching.
// TODO: replace Record<string, never> with the real props interface.
export type HostControlsProps = Record<string, never>;

export default function HostControls(_props: HostControlsProps) {
  return null;
}
