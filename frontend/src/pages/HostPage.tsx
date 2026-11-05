import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getValidAccessToken } from "@/api/client";
import { getGame } from "@/api/games";
import CountdownBar from "@/components/game/CountdownBar";
import Leaderboard from "@/components/game/Leaderboard";
import Podium from "@/components/game/Podium";
import QuestionCard from "@/components/game/QuestionCard";
import HostControls from "@/components/host/HostControls";
import ConnectionBanner from "@/components/lobby/ConnectionBanner";
import JoinCode from "@/components/lobby/JoinCode";
import PlayerList from "@/components/lobby/PlayerList";
import { useCountdown } from "@/hooks/useCountdown";
import { useGameSocket } from "@/hooks/useGameSocket";
import { useAuthStore } from "@/store/authStore";
import { useGameStore } from "@/store/gameStore";
import type { Game } from "@/types/api";

// Stable on purpose: a new object each render would make the socket hook reconnect.
const HOST_SOCKET_OPTIONS = { refreshToken: getValidAccessToken };

// Smart container: lobby, start, question control, leaderboard
export default function HostPage() {
  const { code = "" } = useParams<{ code: string }>();
  // Capture the JWT once: a background token refresh must not tear down the socket.
  const [token] = useState(() => useAuthStore.getState().access);
  const { send, connectionState, reconnectNow } = useGameSocket(code, token, HOST_SOCKET_OPTIONS);

  const status = useGameStore((s) => s.status);
  const locked = useGameStore((s) => s.locked);
  const players = useGameStore((s) => s.players);
  const closeCode = useGameStore((s) => s.closeCode);
  const lastError = useGameStore((s) => s.lastError);
  const clearError = useGameStore((s) => s.clearError);
  const question = useGameStore((s) => s.question);
  const clockOffsetMs = useGameStore((s) => s.clockOffsetMs);
  const revealed = useGameStore((s) => s.revealed);
  const correctChoiceId = useGameStore((s) => s.correctChoiceId);
  const awarded = useGameStore((s) => s.awarded);
  const answerProgress = useGameStore((s) => s.answerProgress);
  const leaderboard = useGameStore((s) => s.leaderboard);
  const countdown = useCountdown(question, clockOffsetMs);

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

      <ConnectionBanner state={connectionState} closeCode={closeCode} onRetry={reconnectNow} />
      {status === "LOBBY" && <JoinCode code={code} />}

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
      ) : status === "FINISHED" ? (
        <>
          <h2>Final results</h2>
          <Podium players={leaderboard} />
          <div className="toolbar">
            <Link className="button" to={`/history/${code}`}>
              Full results and CSV
            </Link>
            <Link to="/quizzes">Back to quizzes</Link>
          </div>
        </>
      ) : question ? (
        <>
          <CountdownBar
            remainingMs={countdown.remainingMs}
            totalMs={countdown.totalMs}
            state={countdown.state}
          />
          <QuestionCard
            question={question}
            selectedChoiceId={null}
            correctChoiceId={correctChoiceId}
            revealed={revealed}
          />
          <div className="toolbar">
            <p role="status" className="muted">
              {answerProgress
                ? `${answerProgress.answered} of ${answerProgress.total} players answered`
                : "Waiting for answers…"}
            </p>
            <button
              type="button"
              className="secondary"
              disabled={!open}
              onClick={() => {
                clearError();
                send({ type: "HOST_NEXT", payload: {} });
              }}
            >
              {!revealed
                ? "End question now"
                : question.index + 1 === question.total
                  ? "Show final results"
                  : "Next question now"}
            </button>
          </div>
          {revealed && (
            <>
              <h2>Leaderboard</h2>
              <Leaderboard players={leaderboard} awarded={awarded} limit={10} />
            </>
          )}
        </>
      ) : (
        <p role="status">Starting the game…</p>
      )}
    </main>
  );
}
