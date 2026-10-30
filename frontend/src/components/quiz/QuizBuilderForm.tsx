import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import FormField from "@/components/common/FormField";
import TextAreaField from "@/components/common/TextAreaField";
import type { QuizInput } from "@/types/api";
import { errorsAt, errorsUnder, type FieldErrors } from "@/utils/formErrors";
import QuestionEditor from "./QuestionEditor";
import { draftToInput, newQuestion, type QuestionDraft, type QuizDraft } from "./quizDraft";

interface Props {
  initial: QuizDraft;
  submitLabel: string;
  submitting: boolean;
  /** Message not tied to a field (network down, 403, "Please fix the highlighted fields.", ...). */
  formError?: string;
  /** Server validation errors, keyed by field name or dotted path ("questions.0.choices"). */
  fieldErrors: FieldErrors;
  onSubmit: (input: QuizInput) => void;
}

/** Presentational: owns the draft being edited; QuizBuilderPage does the network work. */
export default function QuizBuilderForm({
  initial,
  submitLabel,
  submitting,
  formError,
  fieldErrors,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState<QuizDraft>(initial);
  const formRef = useRef<HTMLFormElement>(null);
  const bannerRef = useRef<HTMLParagraphElement>(null);

  // After a failed save, move focus to the first problem so keyboard/screen-reader users land on it.
  useEffect(() => {
    if (Object.keys(fieldErrors).length > 0) {
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-field-error]')
        ?.focus();
    } else if (formError) {
      bannerRef.current?.focus();
    }
  }, [fieldErrors, formError]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(draftToInput(draft));
  };

  const updateQuestion = (index: number, next: QuestionDraft) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, i) => (i === index ? next : q)) }));

  const moveQuestion = (index: number, direction: -1 | 1) =>
    setDraft((d) => {
      const target = index + direction;
      if (target < 0 || target >= d.questions.length) return d;
      const questions = [...d.questions];
      const [moved] = questions.splice(index, 1);
      if (!moved) return d;
      questions.splice(target, 0, moved);
      return { ...d, questions };
    });

  const removeQuestion = (index: number) =>
    setDraft((d) => ({ ...d, questions: d.questions.filter((_, i) => i !== index) }));

  const questionListErrors = errorsAt(fieldErrors, "questions");

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate aria-labelledby="builder-title">
      <h1 id="builder-title">{submitLabel === "Create quiz" ? "New quiz" : "Edit quiz"}</h1>

      {formError && (
        <p role="alert" className="form-error" tabIndex={-1} ref={bannerRef}>
          {formError}
        </p>
      )}

      <div className="panel">
        <FormField
          label="Title"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          errors={errorsAt(fieldErrors, "title")}
          maxLength={120}
          required
        />
        <TextAreaField
          label="Description"
          rows={3}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          errors={errorsAt(fieldErrors, "description")}
        />
        <FormField
          label="Tags (comma separated)"
          value={draft.tags}
          onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
          errors={errorsUnder(fieldErrors, "tags")}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={draft.is_published}
            onChange={(e) => setDraft({ ...draft, is_published: e.target.checked })}
          />
          Published (needs at least one question)
        </label>
      </div>

      <h2>Questions ({draft.questions.length})</h2>
      {questionListErrors && questionListErrors.length > 0 && (
        <ul className="field-error" role="alert" tabIndex={-1} data-field-error>
          {questionListErrors.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      )}

      {draft.questions.map((question, index) => (
        <QuestionEditor
          key={question.key}
          index={index}
          total={draft.questions.length}
          question={question}
          fieldErrors={fieldErrors}
          onChange={(next) => updateQuestion(index, next)}
          onMove={(direction) => moveQuestion(index, direction)}
          onRemove={() => removeQuestion(index)}
        />
      ))}

      <button
        type="button"
        className="secondary"
        onClick={() => setDraft((d) => ({ ...d, questions: [...d.questions, newQuestion()] }))}
      >
        Add question
      </button>

      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </button>
        <Link to="/quizzes">Cancel</Link>
      </div>
    </form>
  );
}
