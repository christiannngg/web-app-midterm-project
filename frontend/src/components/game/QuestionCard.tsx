import { useEffect, useRef } from "react";
import type { QuestionPayload } from "@/types/ws";

export interface QuestionCardProps {
  question: QuestionPayload;
  /** The choice this viewer picked, if any. */
  selectedChoiceId: number | null;
  /** Known once the question has closed. */
  correctChoiceId: number | null;
  /** The question is over and the answer is on screen. */
  revealed: boolean;
  /** Called when a choice is tapped. Omit it for a read-only view (the host's screen). */
  onSelect?: (choiceId: number) => void;
  /** Players can't pick once they've answered or time is up. */
  locked?: boolean;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];

// Presentational (dumb) component: props in, JSX out, no data fetching.
export default function QuestionCard({
  question,
  selectedChoiceId,
  correctChoiceId,
  revealed,
  onSelect,
  locked = false,
}: QuestionCardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const interactive = onSelect !== undefined;
  // A new question replaces the old one in place, which a screen reader would never notice.
  // Players get focus on the question (so it is read out); the host's read-only screen does not.
  // Keyed on the question id, so a reconnect that re-sends the same question doesn't steal focus.
  useEffect(() => {
    if (interactive) headingRef.current?.focus();
  }, [question.id, interactive]);

  return (
    <section className="question-live" aria-labelledby="question-text">
      <p className="meta">
        Question {question.index + 1} of {question.total}
      </p>
      <h2 id="question-text" ref={headingRef} tabIndex={-1}>
        {question.text}
      </h2>
      <ul className="answer-grid">
        {question.choices.map((choice, i) => {
          const picked = choice.id === selectedChoiceId;
          const isCorrect = revealed && choice.id === correctChoiceId;
          const isWrongPick = revealed && picked && choice.id !== correctChoiceId;
          const state = isCorrect ? "correct" : isWrongPick ? "wrong" : picked ? "picked" : "idle";
          const label = (
            <>
              <span className="answer-letter" aria-hidden="true">
                {LETTERS[i] ?? i + 1}
              </span>
              <span className="answer-text">{choice.text}</span>
              {isCorrect && <span className="answer-flag">✓ Correct</span>}
              {isWrongPick && <span className="answer-flag">✗ Your answer</span>}
              {picked && !revealed && <span className="answer-flag">Locked in</span>}
            </>
          );
          return (
            <li key={choice.id}>
              {onSelect ? (
                <button
                  type="button"
                  className="answer"
                  data-state={state}
                  aria-pressed={picked}
                  disabled={locked || revealed}
                  onClick={() => onSelect(choice.id)}
                >
                  {label}
                </button>
              ) : (
                <div className="answer" data-state={state}>
                  {label}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
