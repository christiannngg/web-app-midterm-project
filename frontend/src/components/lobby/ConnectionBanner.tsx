import { CLOSE_CODE, type ConnectionState } from "@/types/ws";

interface Props {
  state: ConnectionState;
  closeCode: number | null;
  /** Skip the wait and reconnect right now (only offered while reconnecting). */
  onRetry?: () => void;
}

function rejectedMessage(closeCode: number | null): string {
  switch (closeCode) {
    case CLOSE_CODE.NOT_FOUND:
      return "That game doesn't exist (or has been deleted).";
    case CLOSE_CODE.FORBIDDEN:
      return "You aren't part of this game.";
    default:
      return "Your sign-in isn't valid for this game. Try joining again.";
  }
}

/** Presentational: says what the socket is doing when it isn't happily open. */
export default function ConnectionBanner({ state, closeCode, onRetry }: Props) {
  if (state === "connecting") {
    return (
      <p role="status" className="muted">
        Connecting…
      </p>
    );
  }
  if (state === "reconnecting") {
    return (
      <div role="status" className="connection-banner">
        <p>Connection lost. Reconnecting… the game will pick up where it is.</p>
        {onRetry && (
          <button type="button" className="secondary" onClick={onRetry}>
            Try now
          </button>
        )}
      </div>
    );
  }
  if (state === "rejected") {
    return (
      <p role="alert" className="form-error">
        {rejectedMessage(closeCode)}
      </p>
    );
  }
  return null; // open, idle, kicked (the page says so itself) and closed (the game is over)
}
