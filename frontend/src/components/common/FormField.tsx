import { useId, type InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  errors?: string[];
}

/** Labelled input with its server-side errors announced next to it. */
export default function FormField({ label, errors, ...inputProps }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const hasErrors = !!errors && errors.length > 0;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={hasErrors}
        aria-describedby={hasErrors ? errorId : undefined}
        {...inputProps}
      />
      {hasErrors && (
        <ul id={errorId} className="field-error" role="alert">
          {errors.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
