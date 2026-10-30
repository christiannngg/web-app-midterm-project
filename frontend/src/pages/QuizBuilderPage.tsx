import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { normalizeError } from "@/api/client";
import { createQuiz, getQuiz, updateQuiz } from "@/api/quizzes";
import QuizBuilderForm from "@/components/quiz/QuizBuilderForm";
import { draftFromQuiz, emptyQuizDraft, type QuizDraft } from "@/components/quiz/quizDraft";
import type { QuizInput } from "@/types/api";
import type { FieldErrors } from "@/utils/formErrors";

// Smart page for /quizzes/new and /quizzes/:id/edit: loads, saves, and maps API errors to fields.
export default function QuizBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const quizId = id === undefined ? undefined : Number(id);
  const invalidId = quizId !== undefined && !Number.isInteger(quizId);

  const [initial, setInitial] = useState<QuizDraft | null>(
    quizId === undefined ? emptyQuizDraft() : null,
  );
  const [loadError, setLoadError] = useState<string | undefined>(
    invalidId ? "Quiz not found." : undefined,
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (quizId === undefined || invalidId) return;
    let cancelled = false;
    getQuiz(quizId)
      .then((quiz) => {
        if (!cancelled) setInitial(draftFromQuiz(quiz));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(normalizeError(err).detail);
      });
    return () => {
      cancelled = true;
    };
  }, [quizId, invalidId]);

  const handleSubmit = async (input: QuizInput) => {
    setSubmitting(true);
    setFormError(undefined);
    setFieldErrors({});
    try {
      if (quizId === undefined) await createQuiz(input);
      else await updateQuiz(quizId, input);
      navigate("/quizzes");
    } catch (err) {
      const body = normalizeError(err);
      setFieldErrors(body.fields ?? {});
      setFormError(body.detail);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <main className="wide">
        <p role="alert" className="form-error">
          {loadError}
        </p>
        <Link to="/quizzes">Back to my quizzes</Link>
      </main>
    );
  }
  if (!initial) {
    return (
      <main className="wide">
        <p role="status">Loading…</p>
      </main>
    );
  }

  return (
    <main className="wide">
      <QuizBuilderForm
        initial={initial}
        submitLabel={quizId === undefined ? "Create quiz" : "Save changes"}
        submitting={submitting}
        formError={formError}
        fieldErrors={fieldErrors}
        onSubmit={(input) => void handleSubmit(input)}
      />
    </main>
  );
}
