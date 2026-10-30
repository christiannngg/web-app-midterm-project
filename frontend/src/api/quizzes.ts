import type { Paginated, Quiz, QuizInput, QuizListParams, QuizSummary } from "@/types/api";
import { http } from "./client";

export async function listQuizzes(params: QuizListParams = {}): Promise<Paginated<QuizSummary>> {
  const { data } = await http.get<Paginated<QuizSummary>>("/quizzes/", { params });
  return data;
}

export async function getQuiz(id: number): Promise<Quiz> {
  const { data } = await http.get<Quiz>(`/quizzes/${id}/`);
  return data;
}

export async function createQuiz(input: QuizInput): Promise<Quiz> {
  const { data } = await http.post<Quiz>("/quizzes/", input);
  return data;
}

/** Full replace (PUT): the payload's questions/choices become the quiz's questions/choices. */
export async function updateQuiz(id: number, input: QuizInput): Promise<Quiz> {
  const { data } = await http.put<Quiz>(`/quizzes/${id}/`, input);
  return data;
}

export async function deleteQuiz(id: number): Promise<void> {
  await http.delete(`/quizzes/${id}/`);
}
