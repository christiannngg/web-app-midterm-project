import type { TokenPair, User } from "@/types/api";
import { http } from "./client";

export async function login(username: string, password: string): Promise<TokenPair> {
  const { data } = await http.post<TokenPair>("/auth/login/", { username, password });
  return data;
}

export async function fetchMe(): Promise<User> {
  const { data } = await http.get<User>("/auth/me/");
  return data;
}
// TODO: register()
