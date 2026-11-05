import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import CountdownBar from "@/components/game/CountdownBar";
import Leaderboard from "@/components/game/Leaderboard";
import Podium from "@/components/game/Podium";
import QuestionCard from "@/components/game/QuestionCard";
import ConnectionBanner from "@/components/lobby/ConnectionBanner";
import JoinCode from "@/components/lobby/JoinCode";
import PlayerList from "@/components/lobby/PlayerList";
import { useCountdown } from "@/hooks/useCountdown";
import { useGameSocket } from "@/hooks/useGameSocket";
import { useGameStore } from "@/store/gameStore";
import { notify } from "@/store/toastStore";
import { CLOSE_CODE } from "@/types/ws";
import { clearPlayerSession, loadPlayerSession } from "@/utils/playerSession";

// Smart container: waiting, answering, results
export default function PlayPage() {
  const { code = "" } = useParams<{ code: string }>();
  const session = useMemo(() => loadPlayerSession(code), [code]);
  const { send, connectionState, reconnectNow } = useGameSocket(code, session?.token ?? null);

  const status = useGameStore((s) => s.status);
  const players = useGameStore((s) => s.players);
  const closeCode = useGameStore((s) => s.closeCode);
  const question = useGameStore((s) => s.question);
  const clockOffsetMs = useGameStore((s) => s.clockOffsetMs);
  const revealed = useGameStore((s) => s.revealed);
  const correctChoiceId = useGameStore((s) => s.correctChoiceId);
  const awarded = useGameStore((s) => s.awarded);
  const myChoiceId = useGameStore((s) => s.myChoiceId);
  const leaderboard = useGameStore((s) => s.leaderboard);
  const lastError = useGameStore((s) => s.lastError);
  const selectChoice = useGameStore((s) => s.selectChoice);

  const countdown = useCountdown(question, clockOffsetMs);

  // The socket is open: tell the server we're in the room so everyone's lobby lists us as online.
  useEffect(() => {
    if (connectionState === "open") send({ type: "LOBBY_JOIN", payload: {} });
  }, [connectionState, send]);

  // A dead seat (kicked, or a token the server no longer accepts) must not be reused on refresh.
  useEffect(() => {
    const dead =
      connectionState === "kicked" ||
      (connectionState === "rejected" &&
        (closeCode === CLOSE_CODE.UNAUTHORIZED || closeCode === CLOSE_CODE.FORBIDDEN));
    if (dead) clearPlayerSession(code);
  }, [connectionState, closeCode, code]);

  if (!session) {
    return (
      <main>
        <h1>Join this game</h1>
        <p role="alert">You haven't joined game {code} yet.</p>
        <Link to={`/?code=${code}`}>Enter a nickname</Link>
      </main>
    );
  }

  if (connectionState === "kicked") {
    return (
      <main>
        <h1>Removed from game</h1>
        <p role="alert">The host removed you from this game.</p>
        <Link to="/">Back to home</Link>
      </main>
    );
  }

  const selfId = session.playerId;
  // One answer per question: lock as soon as we've picked, once time is up, after the reveal,
  // and while offline (an answer sent into a dead connection would look locked in but be lost).
  const locked =
    myChoiceId !== null ||
    countdown.state !== "running" ||
    revealed ||
    connectionState !== "open";
  const myRank = leaderboard.findIndex((p) => p.id === selfId) + 1;
  const myPoints = awarded[selfId] ?? 0;

  const onSelect = (choiceId: number) => {
    if (!question || locked) return;
    const sent = send({ type: "ANSWER_SUBMIT", payload: { questionId: question.id, choiceId } });
    if (sent) selectChoice(choiceId);
    else notify.error("You're offline, so that answer wasn't sent. Try again once you're back.");
  };

  if (status === "FINISHED") {
    return (
      <main className="wide lobby">
        <h1>Game over</h1>
        <ConnectionBanner state={connectionState} closeCode={closeCode} onRetry={reconnectNow} />
        <Podium players={leaderboard} selfId={selfId} />
        <Link to="/">Play again</Link>
      </main>
    );
  }

  if (status === "IN_PROGRESS") {
    return (
      <main className="wide lobby">
        <ConnectionBanner state={connectionState} closeCode={closeCode} onRetry={reconnectNow} />
        {lastError && (
          <p role="alert" className="form-error">
            {lastError.detail}
          </p>
        )}
        {question ? (
          <>
            <CountdownBar
              remainingMs={countdown.remainingMs}
              totalMs={countdown.totalMs}
              state={countdown.state}
            />
            <QuestionCard
              question={question}
              selectedChoiceId={myChoiceId}
              correctChoiceId={correctChoiceId}
              revealed={revealed}
              locked={locked}
              onSelect={onSelect}
            />
            <p
              role="status"
              className={
                revealed
                  ? `result-banner ${myPoints > 0 ? "good" : "bad"}`
                  : "result-banner"
              }
            >
              {revealed
                ? myChoiceId === null
                  ? "No answer this time. 0 points."
                  : myPoints > 0
                    ? `Correct! +${myPoints} points`
                    : "Not this time. 0 points."
                : myChoiceId !== null
                  ? "Answer locked in. Waiting for the others…"
                  : connectionState !== "open"
                    ? "Reconnecting… you can answer as soon as you're back."
                    : countdown.state === "expired"
                      ? "Time's up!"
                      : "Pick an answer"}
            </p>
            {revealed && (
              <>
                {myRank > 0 && <p>You're in place {myRank}.</p>}
                <Leaderboard players={leaderboard} selfId={selfId} awarded={awarded} limit={5} />
              </>
            )}
          </>
        ) : (
          <p role="status">Get ready, the first question is coming…</p>
        )}
      </main>
    );
  }

  return (
    <main className="lobby">
      <h1>You're in, {session.nickname}!</h1>
      <ConnectionBanner state={connectionState} closeCode={closeCode} onRetry={reconnectNow} />
      <JoinCode code={code} />
      <p role="status">Waiting for the host to start the game…</p>
      <h2>Players ({players.length})</h2>
      <PlayerList players={players} selfId={selfId} />
    </main>
  );
}
