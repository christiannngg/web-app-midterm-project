import { Link } from "react-router-dom";
import type { QuizSummary } from "@/types/api";

interface Props {
  quizzes: QuizSummary[];
  onDelete: (quiz: QuizSummary) => void;
}

/** Presentational: one card per quiz with edit/delete actions. */
export default function QuizList({ quizzes, onDelete }: Props) {
  return (
    <ul className="quiz-list">
      {quizzes.map((quiz) => (
        <li key={quiz.id} className="quiz-card">
          <div>
            <h2>{quiz.title}</h2>
            {quiz.description && <p className="muted">{quiz.description}</p>}
            <p className="meta">
              <span className={quiz.is_published ? "badge published" : "badge"}>
                {quiz.is_published ? "Published" : "Draft"}
              </span>{" "}
              {quiz.question_count} {quiz.question_count === 1 ? "question" : "questions"}
              {quiz.tags.length > 0 && (
                <>
                  {" · "}
                  <span className="tags">
                    {quiz.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="toolbar">
            <Link className="button secondary" to={`/quizzes/${quiz.id}/edit`}>
              Edit<span className="sr-only"> {quiz.title}</span>
            </Link>
            <button type="button" className="danger" onClick={() => onDelete(quiz)}>
              Delete<span className="sr-only"> {quiz.title}</span>
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
