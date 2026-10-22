export interface TokenPair {
  access: string;
  refresh: string;
}

export interface User {
  id: number;
  username: string;
  role: "host" | "player";
}

/** Uniform error envelope from backend apps/common_exceptions.py */
export interface ApiErrorBody {
  code: string;
  detail: string;
  fields?: Record<string, string[]>;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
