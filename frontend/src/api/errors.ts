/** What the user is told for each failure. One place, so every screen words an error the same way. */
export const ERROR_MESSAGES = {
  network: "Can't reach the server. Check your connection.",
  badRequest: "That request wasn't valid. Please check it and try again.",
  sessionExpired: "Your session has expired. Please sign in again.",
  forbidden: "You don't have permission to do that.",
  notFound: "We couldn't find that. It may have been deleted.",
  tooManyRequests: "Too many requests. Wait a moment and try again.",
  server: "Something went wrong on our side. Please try again in a moment.",
  unknown: "Something went wrong. Please try again.",
} as const;

/** The fallback message for an HTTP status, used when the server's body isn't our JSON envelope. */
export function messageForStatus(status: number | undefined): string {
  if (status === undefined) return ERROR_MESSAGES.network;
  if (status === 400) return ERROR_MESSAGES.badRequest;
  if (status === 401) return ERROR_MESSAGES.sessionExpired;
  if (status === 403) return ERROR_MESSAGES.forbidden;
  if (status === 404) return ERROR_MESSAGES.notFound;
  if (status === 429) return ERROR_MESSAGES.tooManyRequests;
  if (status >= 500) return ERROR_MESSAGES.server;
  return ERROR_MESSAGES.unknown;
}
