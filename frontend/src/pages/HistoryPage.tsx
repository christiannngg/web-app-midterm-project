import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { normalizeError } from "@/api/client";
import { listHistory } from "@/api/history";
import HistoryList from "@/components/history/HistoryList";
import type { GameHistoryItem, Paginated } from "@/types/api";

// Smart page: the host's finished games, with paging. <HistoryList> just renders.
export default function HistoryPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<GameHistoryItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    listHistory(page)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(normalizeError(err).detail);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  return (
    <main className="wide">
      <header className="page-header">
        <h1>Game history</h1>
        <Link to="/quizzes">Back to quizzes</Link>
      </header>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading…</p>}

      {data && data.results.length > 0 && <HistoryList games={data.results} />}
      {data && data.results.length === 0 && !loading && !error && (
        <p className="muted">
          No finished games yet. Host a quiz and play it to the end, and it shows up here.
        </p>
      )}

      {data && (data.previous || data.next) && (
        <nav className="pagination" aria-label="History pages">
          <button
            type="button"
            className="secondary"
            onClick={() => setPage(page - 1)}
            disabled={!data.previous || loading}
          >
            Previous
          </button>
          <span>
            Page {page} · {data.count} games
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => setPage(page + 1)}
            disabled={!data.next || loading}
          >
            Next
          </button>
        </nav>
      )}
    </main>
  );
}
