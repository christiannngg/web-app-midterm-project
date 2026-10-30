import type { ChangeEvent } from "react";
import FormField from "@/components/common/FormField";
import { errorsAt, type FieldErrors } from "@/utils/formErrors";
import { MAX_CHOICES, MIN_CHOICES, newChoice, type QuestionDraft } from "./quizDraft";

interface Props {
  index: number;
  total: number;
  question: QuestionDraft;
  /** All server errors for the quiz; this component reads the `questions.<index>.*` ones. */
  fieldErrors: FieldErrors;
  onChange: (next: QuestionDraft) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

/** Presentational: one question with its settings and choices. */
export default function QuestionEditor({
  index,
  total,
  question,
  fieldErrors,
  onChange,
  onMove,
  onRemove,
}: Props) {
  const path = `questions.${index}`;
  const number = index + 1;
  const choiceGroupErrors = errorsAt(fieldErrors, `${path}.choices`);

  const setField =
    (field: "text" | "time_limit_s" | "points") => (e: ChangeEvent<HTMLInputElement>) =>
      onChange({ ...question, [field]: e.target.value });

  const setChoiceText = (key: string, text: string) =>
    onChange({
      ...question,
      choices: question.choices.map((c) => (c.key === key ? { ...c, text } : c)),
    });

  const setCorrect = (key: string) =>
    onChange({
      ...question,
      choices: question.choices.map((c) => ({ ...c, is_correct: c.key === key })),
    });

  const removeChoice = (key: string) =>
    onChange({ ...question, choices: question.choices.filter((c) => c.key !== key) });

  const addChoice = () => onChange({ ...question, choices: [...question.choices, newChoice()] });

  return (
    <section className="question-card" aria-labelledby={`${question.key}-title`}>
      <header className="question-header">
        <h3 id={`${question.key}-title`}>Question {number}</h3>
        <div className="toolbar">
          <button
            type="button"
            className="secondary"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Move question ${number} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={`Move question ${number} down`}
          >
            ↓
          </button>
          <button
            type="button"
            className="danger"
            onClick={onRemove}
            aria-label={`Remove question ${number}`}
          >
            Remove
          </button>
        </div>
      </header>

      <FormField
        label="Question text"
        value={question.text}
        onChange={setField("text")}
        errors={errorsAt(fieldErrors, `${path}.text`)}
        maxLength={300}
      />

      <div className="field-row">
        <FormField
          label="Time limit (seconds)"
          type="number"
          inputMode="numeric"
          min={5}
          max={120}
          value={question.time_limit_s}
          onChange={setField("time_limit_s")}
          errors={errorsAt(fieldErrors, `${path}.time_limit_s`)}
        />
        <FormField
          label="Points"
          type="number"
          inputMode="numeric"
          min={0}
          value={question.points}
          onChange={setField("points")}
          errors={errorsAt(fieldErrors, `${path}.points`)}
        />
      </div>

      <fieldset className="choices">
        <legend>Choices (select the correct one)</legend>
        {question.choices.map((choice, ci) => (
          <div className="choice-row" key={choice.key}>
            <input
              type="radio"
              name={`correct-${question.key}`}
              checked={choice.is_correct}
              onChange={() => setCorrect(choice.key)}
              aria-label={`Choice ${ci + 1} is the correct answer`}
            />
            <FormField
              label={`Choice ${ci + 1} text`}
              hideLabel
              placeholder={`Choice ${ci + 1}`}
              value={choice.text}
              onChange={(e) => setChoiceText(choice.key, e.target.value)}
              errors={errorsAt(fieldErrors, `${path}.choices.${ci}.text`)}
              maxLength={200}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => removeChoice(choice.key)}
              disabled={question.choices.length <= MIN_CHOICES}
              aria-label={`Remove choice ${ci + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
        {choiceGroupErrors && choiceGroupErrors.length > 0 && (
          <ul className="field-error" role="alert" tabIndex={-1} data-field-error>
            {choiceGroupErrors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="secondary"
          onClick={addChoice}
          disabled={question.choices.length >= MAX_CHOICES}
        >
          Add choice
        </button>
      </fieldset>
    </section>
  );
}
