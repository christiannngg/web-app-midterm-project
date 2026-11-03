export interface HostControlsProps {
  locked: boolean;
  /** Players whose socket is open right now; Start needs at least one. */
  connectedCount: number;
  /** False while the host's own socket isn't open, so nothing can be sent. */
  enabled: boolean;
  onToggleLock: () => void;
  onStart: () => void;
}

// Presentational (dumb) component: props in, JSX out, no data fetching.
export default function HostControls({
  locked,
  connectedCount,
  enabled,
  onToggleLock,
  onStart,
}: HostControlsProps) {
  const canStart = enabled && connectedCount > 0;
  return (
    <div className="toolbar">
      <button type="button" onClick={onStart} disabled={!canStart} aria-describedby="start-hint">
        Start game
      </button>
      <button
        type="button"
        className="secondary"
        onClick={onToggleLock}
        disabled={!enabled}
        aria-pressed={locked}
      >
        {locked ? "Unlock lobby" : "Lock lobby"}
      </button>
      <span id="start-hint" className="muted">
        {locked ? "Lobby locked: no new players can join. " : ""}
        {connectedCount === 0 ? "Waiting for a player to join…" : `${connectedCount} ready`}
      </span>
    </div>
  );
}
