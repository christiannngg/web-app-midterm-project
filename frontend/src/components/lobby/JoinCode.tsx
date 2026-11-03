interface Props {
  code: string;
}

/** Presentational: the join code, big enough to read off a projector. */
export default function JoinCode({ code }: Props) {
  return (
    <section className="join-code" aria-label="Join code">
      <p className="muted">Join with code</p>
      {/* Spaced out so a screen reader reads letters, not a word. */}
      <p className="join-code-value" aria-label={code.split("").join(" ")}>
        {code}
      </p>
    </section>
  );
}
