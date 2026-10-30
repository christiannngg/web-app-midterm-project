import { useId, type InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  errors?: string[];
  /** Keep the label for screen readers but don't draw it (e.g. repeated rows of inputs). */
  hideLabel?: boolean;
}

/** Labelled input with its server-side errors announced next to it. */
export default function FormField({ label, errors, hideLabel, ...inputProps }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const hasErrors = !!errors && errors.length > 0;
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </label>
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
