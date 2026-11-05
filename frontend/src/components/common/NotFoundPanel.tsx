import { Link } from "react-router-dom";

interface Props {
  title?: string;
  message?: string;
  backTo?: string;
  backLabel?: string;
}

/** Presentational 404: used for unknown URLs and for a game/quiz that doesn't exist (or isn't yours). */
export default function NotFoundPanel({
  title = "Page not found",
  message = "That page doesn't exist, or it has moved.",
  backTo = "/",
  backLabel = "Back to home",
}: Props) {
  return (
    <main>
      <h1>{title}</h1>
      <p role="alert">{message}</p>
      <Link to={backTo}>{backLabel}</Link>
    </main>
  );
}
