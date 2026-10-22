// Presentational (dumb) component: props in, JSX out, no data fetching.
// TODO: replace Record<string, never> with the real props interface.
export type QuestionCardProps = Record<string, never>;

export default function QuestionCard(_props: QuestionCardProps) {
  return null;
}
