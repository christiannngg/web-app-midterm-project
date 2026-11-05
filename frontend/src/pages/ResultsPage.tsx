import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getErrorStatus, normalizeError } from "@/api/client";
import { downloadResultsCsv, getResults } from "@/api/history";
import NotFoundPanel from "@/components/common/NotFoundPanel";
import QuestionBreakdown from "@/components/history/QuestionBreakdown";
import StandingsTable from "@/components/history/StandingsTable";
import { notify } from "@/store/toastStore";
import type { GameResults } from "@/types/api";
import { saveBlob } from "@/utils/download";
import { formatDateTime, plural } from "@/utils/format";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; results: GameResults }
  | { kind: "not-found" }
  | { kind: "not-finished" }
  | { kind: "error"; message: string };

// Smart page for /history/:code: loads one finished game and offers the CSV download.
export default function ResultsPage() {
  const { code = "" } = useParams<{ code: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getResults(code)
      .then((results) => {
        if (!cancelled) setState({ kind: "ready", results });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = getErrorStatus(err);
        if (status === 404) setState({ kind: "not-found" });
        else if (status === 409) setState({ kind: "not-finished" });
        else setState({ kind: "error", message: normalizeError(err).detail });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { blob, filename } = await downloadResultsCsv(code);
      saveBlob(blob, filename);
      notify.success("Results downloaded.");
    } catch {
      // The API client already told the user what went wrong.
    } finally {
      setDownloading(false);
    }
  };

  if (state.kind === "not-found") {
    return (
      <NotFoundPanel
        title="Game not found"
        message="We couldn't find a finished game with that code among your games."
        backTo="/history"
        backLabel="Back to game history"
      />
    );
  }
  if (state.kind === "not-finished") {
    return (
      <main>
        <h1>Game still in progress</h1>
        <p role="alert">Results are available once the game has finished.</p>
        <Link to={`/host/${code}`}>Go to the game</Link>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main>
        <h1>Results</h1>
        <p role="alert" className="form-error">
          {state.message}
        </p>
        <Link to="/history">Back to game history</Link>
      </main>
    );
  }
  if (state.kind === "loading") {
    return (
      <main className="wide">
        <p role="status">Loading…</p>
      </main>
    );
  }

  const { results } = state;
  return (
    <main className="wide">
      <header className="page-header">
        <div>
          <h1>{results.quiz_title}</h1>
          <p className="meta">
            Game {results.code} · {formatDateTime(results.ended_at)} ·{" "}
            {plural(results.player_count, "player")} · {plural(results.question_count, "question")}
          </p>
        </div>
        <div className="toolbar">
          <button type="button" onClick={() => void handleDownload()} disabled={downloading}>
            {downloading ? "Preparing…" : "Download CSV"}
          </button>
          <Link to="/history">All games</Link>
        </div>
      </header>

      <h2>Final standings</h2>
      <StandingsTable standings={results.standings} questionCount={results.question_count} />

      <h2>Question by question</h2>
      {results.questions.length > 0 ? (
        <QuestionBreakdown questions={results.questions} />
      ) : (
        <p className="muted">This quiz no longer has any questions.</p>
      )}
    </main>
  );
}
