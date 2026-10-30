/** `fields` from the shared error envelope: field name or dotted path -> messages. */
export type FieldErrors = Record<string, string[]>;

/** Messages for exactly this path, e.g. errorsAt(f, "questions.0.text"). */
export function errorsAt(fields: FieldErrors, path: string): string[] | undefined {
  return fields[path];
}

/** Messages for this path and anything nested below it ("tags" also matches "tags.2"). */
export function errorsUnder(fields: FieldErrors, path: string): string[] {
  return Object.entries(fields)
    .filter(([key]) => key === path || key.startsWith(`${path}.`))
    .flatMap(([, messages]) => messages);
}
