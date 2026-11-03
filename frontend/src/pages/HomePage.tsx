import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { signOut } from "@/api/auth";
import { normalizeError } from "@/api/client";
import { joinGame } from "@/api/games";
import JoinForm, { type JoinFormValues } from "@/components/lobby/JoinForm";
import { useAuthStore } from "@/store/authStore";
import { savePlayerSession } from "@/utils/playerSession";

// Join a game / host login entry
export default function HomePage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const handleJoin = async ({ code, nickname }: JoinFormValues) => {
    setSubmitting(true);
    setFormError(undefined);
    setFieldErrors({});
    try {
      const joined = await joinGame(code, nickname);
      savePlayerSession(joined.code, {
        token: joined.player_token,
        playerId: joined.player.id,
        nickname: joined.player.nickname,
      });
      navigate(`/play/${joined.code}`);
    } catch (err) {
      const body = normalizeError(err);
      const fields = body.fields ?? {};
      setFieldErrors(fields);
      // Same rule as the login form: inline messages when there are any, banner otherwise.
      setFormError(
        Object.keys(fields).length > 0 ? fields.non_field_errors?.join(" ") : body.detail,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="home">
      <h1>Trivia Tournament</h1>
      <JoinForm
        initialCode={params.get("code") ?? ""}
        submitting={submitting}
        formError={formError}
        fieldErrors={fieldErrors}
        onSubmit={(values) => void handleJoin(values)}
      />
      {user ? (
        <>
          <p>
            Signed in as <strong>{user.username}</strong> ({user.role}).
          </p>
          {user.role === "host" && (
            <p>
              <Link to="/quizzes">My quizzes</Link>
            </p>
          )}
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </>
      ) : (
        <p>
          <Link to="/login">Sign in or create an account</Link> to host a game.
        </p>
      )}
    </main>
  );
}
