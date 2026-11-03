import { useState, type FormEvent } from "react";
import FormField from "@/components/common/FormField";

export interface JoinFormValues {
  code: string;
  nickname: string;
}

interface Props {
  initialCode?: string;
  submitting: boolean;
  /** Message not tied to a field (network down, ...). */
  formError?: string;
  fieldErrors: Record<string, string[]>;
  onSubmit: (values: JoinFormValues) => void;
}

/** Presentational: owns only the input values; HomePage does the network work. */
export default function JoinForm({
  initialCode = "",
  submitting,
  formError,
  fieldErrors,
  onSubmit,
}: Props) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [nickname, setNickname] = useState("");

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit({ code: code.trim().toUpperCase(), nickname: nickname.trim() });
  };

  return (
    <form onSubmit={handleSubmit} noValidate aria-labelledby="join-title" className="auth-card">
      <h2 id="join-title">Join a game</h2>

      {formError && (
        <p role="alert" className="form-error">
          {formError}
        </p>
      )}

      <FormField
        label="Game code"
        name="code"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        errors={fieldErrors.code}
        required
      />
      <FormField
        label="Nickname"
        name="nickname"
        autoComplete="off"
        maxLength={30}
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        errors={fieldErrors.nickname}
        required
      />

      <button type="submit" disabled={submitting}>
        {submitting ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
