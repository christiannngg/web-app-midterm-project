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
