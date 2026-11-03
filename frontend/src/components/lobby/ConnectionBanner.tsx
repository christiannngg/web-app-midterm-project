import { CLOSE_CODE, type ConnectionState } from "@/types/ws";

interface Props {
  state: ConnectionState;
  closeCode: number | null;
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
export default function ConnectionBanner({ state, closeCode }: Props) {
  if (state === "connecting") {
    return (
      <p role="status" className="muted">
        Connecting…
      </p>
    );
  }
  if (state === "rejected") {
    return (
      <p role="alert" className="form-error">
        {rejectedMessage(closeCode)}
      </p>
    );
  }
  if (state === "closed") {
    return (
      <p role="alert" className="form-error">
        Connection lost. Refresh the page to reconnect.
      </p>
    );
  }
  return null;
}
