interface Props {
  /** What to say. Speaks when it changes; "" says nothing. */
  message: string;
}

/** Presentational: a screen-reader-only live region for the countdown's time warnings. */
export default function TimeAnnouncer({ message }: Props) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
