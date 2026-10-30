export interface TokenPair {
  access: string;
  refresh: string;
}

export type Role = "host" | "player";

export interface User {
  id: number;
  username: string;
  role: Role;
}

export interface RegisterPayload {
  username: string;
  password: string;
  role: Role;
}

/** Uniform error envelope from backend apps/common_exceptions.py */
export interface ApiErrorBody {
  code: string;
  detail: string;
  /** 400 only. Keys are field names, or dotted paths for nested data ("questions.0.text"). */
  fields?: Record<string, string[]>;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ---- Quizzes (backend apps/quizzes/serializers.py) ----------------------------------------

export interface Choice {
  id: number;
  text: string;
  is_correct: boolean;
}

export interface Question {
  id: number;
  text: string;
  time_limit_s: number;
  points: number;
  /** Position in the quiz; the server derives it from list order. */
  order: number;
  choices: Choice[];
}

export interface Quiz {
  id: number;
  title: string;
  description: string;
  is_published: boolean;
  /** Lower-case tag names. */
  tags: string[];
  questions: Question[];
  created_at: string;
  updated_at: string;
}

/** Row in the paginated library (`GET /quizzes/`): a count instead of nested questions. */
export interface QuizSummary {
  id: number;
  title: string;
  description: string;
  is_published: boolean;
  tags: string[];
  question_count: number;
  created_at: string;
  updated_at: string;
}

/** Write payload. `id` present = update that row, absent = create; omitted rows are deleted. */
export interface ChoiceInput {
  id?: number;
  text: string;
  is_correct: boolean;
}

export interface QuestionInput {
  id?: number;
  text: string;
  time_limit_s: number;
  points: number;
  choices: ChoiceInput[];
}

export interface QuizInput {
  title: string;
  description: string;
  is_published: boolean;
  tags: string[];
  /** Order in this array becomes the question order. */
  questions: QuestionInput[];
}

export interface QuizListParams {
  search?: string;
  page?: number;
}
