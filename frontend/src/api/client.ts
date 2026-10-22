import axios from "axios";
import type { ApiErrorBody } from "@/types/api";

export const http = axios.create({ baseURL: import.meta.env.VITE_API_URL });

// TODO: request interceptor -> attach `Authorization: Bearer <access>` from auth store
// TODO: response interceptor -> on 401 try refresh once, else logout; map 400/403/404/500
//       into toasts / form errors via normalizeError()

export function normalizeError(err: unknown): ApiErrorBody {
  if (axios.isAxiosError<ApiErrorBody>(err) && err.response?.data) return err.response.data;
  return { code: "network_error", detail: "Something went wrong. Please try again." };
}
