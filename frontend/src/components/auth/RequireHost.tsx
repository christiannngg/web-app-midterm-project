import type { ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

/** Route guard: signed-out users go to /login, players get a clear "hosts only" message. */
export default function RequireHost({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "host") {
    return (
      <main>
        <h1>Hosts only</h1>
        <p role="alert">Your account is a player account, so it can't create quizzes.</p>
        <Link to="/">Back to home</Link>
      </main>
    );
  }
  return <>{children}</>;
}
