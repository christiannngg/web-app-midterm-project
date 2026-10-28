import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { signIn, signUp } from "@/api/auth";
import { normalizeError } from "@/api/client";
import AuthForm, { type AuthFormValues, type AuthMode } from "@/components/auth/AuthForm";
import { useAuthStore } from "@/store/authStore";

// Smart page: talks to the API and the auth store, hands plain props to <AuthForm>.
export default function LoginPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [mode, setMode] = useState<AuthMode>("login");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  if (user) return <Navigate to="/" replace />;

  const handleModeChange = (next: AuthMode) => {
    setMode(next);
    setFormError(undefined);
    setFieldErrors({});
  };

  const handleSubmit = async ({ username, password, role }: AuthFormValues) => {
    setSubmitting(true);
    setFormError(undefined);
    setFieldErrors({});
    try {
      if (mode === "register") await signUp({ username, password, role });
      else await signIn(username, password);
      navigate("/", { replace: true });
    } catch (err) {
      const body = normalizeError(err);
      const fields = body.fields ?? {};
      setFieldErrors(fields);
      // Field errors are shown inline; only fall back to the banner when there are none
      // (401 bad credentials, network down, ...) or when the error isn't about a field.
      setFormError(
        Object.keys(fields).length > 0 ? fields.non_field_errors?.join(" ") : body.detail,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <AuthForm
        key={mode}
        mode={mode}
        submitting={submitting}
        formError={formError}
        fieldErrors={fieldErrors}
        onSubmit={(values) => void handleSubmit(values)}
        onModeChange={handleModeChange}
      />
    </main>
  );
}
