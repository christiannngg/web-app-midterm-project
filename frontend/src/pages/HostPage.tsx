import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getGame } from "@/api/games";
import HostControls from "@/components/host/HostControls";
import ConnectionBanner from "@/components/lobby/ConnectionBanner";
import JoinCode from "@/components/lobby/JoinCode";
import PlayerList from "@/components/lobby/PlayerList";
import { useGameSocket } from "@/hooks/useGameSocket";
import { useAuthStore } from "@/store/authStore";
import { useGameStore } from "@/store/gameStore";
import type { Game } from "@/types/api";

// Smart container: lobby, start, question control, leaderboard
export default function HostPage() {
  const { code = "" } = useParams<{ code: string }>();
  // Capture the JWT once: a background token refresh must not tear down the socket.
  const [token] = useState(() => useAuthStore.getState().access);
  const { send, connectionState } = useGameSocket(code, token);

  const status = useGameStore((s) => s.status);
  const locked = useGameStore((s) => s.locked);
  const players = useGameStore((s) => s.players);
  const closeCode = useGameStore((s) => s.closeCode);
  const lastError = useGameStore((s) => s.lastError);
  const clearError = useGameStore((s) => s.clearError);

  const [game, setGame] = useState<Game | null>(null);
  useEffect(() => {
    let cancelled = false;
    getGame(code)
      .then((g) => {
        if (!cancelled) setGame(g);
      })
      .catch(() => undefined); // title is cosmetic; a bad code shows up as a rejected socket
    return () => {
      cancelled = true;
    };
  }, [code]);

  const connectedCount = players.filter((p) => p.connected).length;
  const open = connectionState === "open";

  return (
    <main className="wide lobby">
      <header className="page-header">
        <h1>{game?.quiz_title ?? "Game lobby"}</h1>
        <Link to="/quizzes">Back to quizzes</Link>
      </header>

      <ConnectionBanner state={connectionState} closeCode={closeCode} />
      <JoinCode code={code} />

      {lastError && (
        <p role="alert" className="form-error">
          {lastError.detail}
        </p>
      )}

      {status === "LOBBY" ? (
        <>
          <HostControls
            locked={locked}
            connectedCount={connectedCount}
            enabled={open}
            onToggleLock={() => {
              clearError();
              send({ type: "HOST_LOCK", payload: { locked: !locked } });
            }}
            onStart={() => {
              clearError();
              send({ type: "HOST_START", payload: {} });
            }}
          />
          <h2>Players ({players.length})</h2>
          <PlayerList
            players={players}
            onKick={(player) => {
              clearError();
              send({ type: "HOST_KICK", payload: { playerId: player.id } });
            }}
          />
        </>
      ) : (
        <>
          <p role="status">The game has started. Live questions arrive in the next phase.</p>
          <h2>Players ({players.length})</h2>
          <PlayerList players={players} />
        </>
      )}
    </main>
  );
}
