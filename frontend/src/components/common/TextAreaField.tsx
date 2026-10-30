import { useId, type TextareaHTMLAttributes } from "react";

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  errors?: string[];
}

/** Labelled textarea with its server-side errors announced next to it (twin of FormField). */
export default function TextAreaField({ label, errors, ...textareaProps }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const hasErrors = !!errors && errors.length > 0;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        aria-invalid={hasErrors}
        aria-describedby={hasErrors ? errorId : undefined}
        {...textareaProps}
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
