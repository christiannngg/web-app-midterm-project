import type { ChoiceInput, Quiz, QuestionInput, QuizInput } from "@/types/api";

/**
 * Editable form state for the quiz builder. Differs from the API shape in three ways:
 *  - every row has a client-only `key` (stable React key; new rows have no server `id` yet)
 *  - numbers are strings so a field can be empty or half-typed while editing
 *  - tags are one comma-separated string
 */
export interface ChoiceDraft {
  key: string;
  id?: number;
  text: string;
  is_correct: boolean;
}

export interface QuestionDraft {
  key: string;
  id?: number;
  text: string;
  time_limit_s: string;
  points: string;
  choices: ChoiceDraft[];
}

export interface QuizDraft {
  title: string;
  description: string;
  tags: string;
  is_published: boolean;
  questions: QuestionDraft[];
}

export const MIN_CHOICES = 2;
export const MAX_CHOICES = 6;
const DEFAULT_CHOICES = 4;

let sequence = 0;
const nextKey = (): string => `draft-${++sequence}`;

export function newChoice(isCorrect = false): ChoiceDraft {
  return { key: nextKey(), text: "", is_correct: isCorrect };
}

export function newQuestion(): QuestionDraft {
  return {
    key: nextKey(),
    text: "",
    time_limit_s: "20",
    points: "1000",
    choices: Array.from({ length: DEFAULT_CHOICES }, (_, i) => newChoice(i === 0)),
  };
}

export function emptyQuizDraft(): QuizDraft {
  return { title: "", description: "", tags: "", is_published: false, questions: [newQuestion()] };
}

export function draftFromQuiz(quiz: Quiz): QuizDraft {
  return {
    title: quiz.title,
    description: quiz.description,
    tags: quiz.tags.join(", "),
    is_published: quiz.is_published,
    questions: quiz.questions.map((q) => ({
      key: nextKey(),
      id: q.id,
      text: q.text,
      time_limit_s: String(q.time_limit_s),
      points: String(q.points),
      choices: q.choices.map((c) => ({
        key: nextKey(),
        id: c.id,
        text: c.text,
        is_correct: c.is_correct,
      })),
    })),
  };
}

/** A blank number field becomes NaN -> JSON null -> the server's "may not be null" message. */
const toNumber = (value: string): number => (value.trim() === "" ? NaN : Number(value));

export function draftToInput(draft: QuizDraft): QuizInput {
  return {
    title: draft.title,
    description: draft.description,
    is_published: draft.is_published,
    tags: draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    questions: draft.questions.map(
      (q): QuestionInput => ({
        ...(q.id === undefined ? {} : { id: q.id }),
        text: q.text,
        time_limit_s: toNumber(q.time_limit_s),
        points: toNumber(q.points),
        choices: q.choices.map(
          (c): ChoiceInput => ({
            ...(c.id === undefined ? {} : { id: c.id }),
            text: c.text,
            is_correct: c.is_correct,
          }),
        ),
      }),
    ),
  };
}
