import { useState, type FormEvent } from "react";
import FormField from "@/components/common/FormField";
import type { Role } from "@/types/api";

export type AuthMode = "login" | "register";

export interface AuthFormValues {
  username: string;
  password: string;
  role: Role;
}

interface Props {
  mode: AuthMode;
  submitting: boolean;
  /** Message not tied to a field (bad credentials, network down, ...). */
  formError?: string;
  fieldErrors: Record<string, string[]>;
  onSubmit: (values: AuthFormValues) => void;
  onModeChange: (mode: AuthMode) => void;
}

/** Presentational: owns only the input values; LoginPage does the network work. */
export default function AuthForm({
  mode,
  submitting,
  formError,
  fieldErrors,
  onSubmit,
  onModeChange,
}: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("host");
  const isRegister = mode === "register";

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit({ username, password, role });
  };

  return (
    <form onSubmit={handleSubmit} noValidate aria-labelledby="auth-title" className="auth-card">
      <h1 id="auth-title">{isRegister ? "Create an account" : "Sign in"}</h1>

      {formError && (
        <p role="alert" className="form-error">
          {formError}
        </p>
      )}

      <FormField
        label="Username"
        name="username"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        errors={fieldErrors.username}
        required
      />
      <FormField
        label="Password"
        name="password"
        type="password"
        autoComplete={isRegister ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        errors={fieldErrors.password}
        required
      />

      {isRegister && (
        <fieldset className="role-picker">
          <legend>I want to</legend>
          <label>
            <input
              type="radio"
              name="role"
              value="host"
              checked={role === "host"}
              onChange={() => setRole("host")}
            />
            Host games
          </label>
          <label>
            <input
              type="radio"
              name="role"
              value="player"
              checked={role === "player"}
              onChange={() => setRole("player")}
            />
            Play games
          </label>
          {fieldErrors.role?.map((msg) => (
            <p key={msg} role="alert" className="field-error">
              {msg}
            </p>
          ))}
        </fieldset>
      )}

      <button type="submit" disabled={submitting}>
        {submitting ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
      </button>

      <p className="switch-mode">
        {isRegister ? "Already have an account? " : "New here? "}
        <button
          type="button"
          className="link-button"
          onClick={() => onModeChange(isRegister ? "login" : "register")}
        >
          {isRegister ? "Sign in" : "Create an account"}
        </button>
      </p>
    </form>
  );
}
