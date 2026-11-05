import type { QuestionResult } from "@/types/api";
import { plural } from "@/utils/format";

interface Props {
  questions: QuestionResult[];
}

/** Presentational: for each question, how many got it right and what everyone picked. */
export default function QuestionBreakdown({ questions }: Props) {
  return (
    <ol className="breakdown">
      {questions.map((q) => (
        <li key={q.id} className="panel">
          <h3>
            <span className="sr-only">Question {q.number}: </span>
            {q.text}
          </h3>
          <p className="meta">
            {q.correct_count} of {plural(q.answered_count, "player")} who answered got it right
          </p>
          <ul className="pick-list">
            {q.choices.map((choice) => {
              const share = q.answered_count > 0 ? (choice.picked_count / q.answered_count) * 100 : 0;
              return (
                <li key={choice.id} className={choice.is_correct ? "pick correct" : "pick"}>
                  <span className="pick-text">
                    {choice.text}
                    {choice.is_correct && <span className="badge published"> Correct answer</span>}
                  </span>
                  <span className="pick-count">{plural(choice.picked_count, "pick")}</span>
                  <span className="pick-bar" aria-hidden="true">
                    <span style={{ width: `${share}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
