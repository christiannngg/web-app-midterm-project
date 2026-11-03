import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import ConnectionBanner from "@/components/lobby/ConnectionBanner";
import JoinCode from "@/components/lobby/JoinCode";
import PlayerList from "@/components/lobby/PlayerList";
import { useGameSocket } from "@/hooks/useGameSocket";
import { useGameStore } from "@/store/gameStore";
import { CLOSE_CODE } from "@/types/ws";
import { clearPlayerSession, loadPlayerSession } from "@/utils/playerSession";

// Smart container: waiting, answering, results
export default function PlayPage() {
  const { code = "" } = useParams<{ code: string }>();
  const session = useMemo(() => loadPlayerSession(code), [code]);
  const { send, connectionState } = useGameSocket(code, session?.token ?? null);

  const status = useGameStore((s) => s.status);
  const players = useGameStore((s) => s.players);
  const closeCode = useGameStore((s) => s.closeCode);

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

  return (
    <main className="lobby">
      <h1>You're in, {session.nickname}!</h1>
      <ConnectionBanner state={connectionState} closeCode={closeCode} />
      <JoinCode code={code} />

      {status === "LOBBY" ? (
        <p role="status">Waiting for the host to start the game…</p>
      ) : (
        <p role="status">The game has started! Questions arrive in the next phase.</p>
      )}

      <h2>Players ({players.length})</h2>
      <PlayerList players={players} selfId={session.playerId} />
    </main>
  );
}
