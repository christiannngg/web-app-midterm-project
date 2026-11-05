const SITE = "Trivia Tournament";

/**
 * The document title for a URL path, so the browser tab, the history list and a screen reader's
 * "page changed" announcement all say where you are. Unknown paths read as "Page not found".
 */
export function pageTitleFor(pathname: string): string {
  return `${titleFor(pathname)} · ${SITE}`;
}

function titleFor(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return "Join a game";
  if (path === "/login") return "Sign in";
  if (path === "/quizzes") return "My quizzes";
  if (path === "/quizzes/new") return "New quiz";
  if (/^\/quizzes\/[^/]+\/edit$/.test(path)) return "Edit quiz";
  if (path === "/history") return "Game history";

  const game = /^\/(host|play|history)\/([^/]+)$/.exec(path);
  if (game) {
    const code = decodeURIComponent(game[2] ?? "");
    if (game[1] === "host") return `Hosting game ${code}`;
    if (game[1] === "play") return `Playing game ${code}`;
    return `Results for game ${code}`;
  }
  return "Page not found";
}
