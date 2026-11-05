import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { deleteQuiz, listQuizzes } from "@/api/quizzes";
import { normalizeError } from "@/api/client";
import { createGame } from "@/api/games";
import QuizList from "@/components/quiz/QuizList";
import type { Paginated, QuizSummary } from "@/types/api";

const SEARCH_DEBOUNCE_MS = 300;

// Smart page: owns search/pagination state and talks to the API; <QuizList> just renders.
export default function QuizListPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<Paginated<QuizSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [hostingId, setHostingId] = useState<number | null>(null);

  // Wait for a pause in typing before searching, and start again from page 1.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    listQuizzes({ search: search || undefined, page })
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
  }, [search, page, reloadKey]);

  const handleDelete = async (quiz: QuizSummary) => {
    if (!window.confirm(`Delete "${quiz.title}"? This can't be undone.`)) return;
    try {
      await deleteQuiz(quiz.id);
      // Deleting the last quiz on a later page would leave an empty page: step back instead.
      if (data && data.results.length === 1 && page > 1) setPage(page - 1);
      else setReloadKey((k) => k + 1);
    } catch {
      // Nothing to add: the API client already showed why it failed (403, 404, 500, offline).
    }
  };

  const handleHost = async (quiz: QuizSummary) => {
    setHostingId(quiz.id);
    setError(undefined);
    try {
      const game = await createGame(quiz.id);
      navigate(`/host/${game.code}`);
    } catch (err) {
      const body = normalizeError(err);
      // A rejected quiz comes back as a field error; show its specific message, not the generic one.
      setError(body.fields?.quiz?.[0] ?? body.detail);
      setHostingId(null);
    }
  };

  return (
    <main className="wide">
      <header className="page-header">
        <h1>My quizzes</h1>
        <div className="toolbar">
          <Link className="button secondary" to="/history">
            Game history
          </Link>
          <Link className="button" to="/quizzes/new">
            New quiz
          </Link>
        </div>
      </header>

      <div className="field search">
        <label htmlFor="quiz-search">Search quizzes</label>
        <input
          id="quiz-search"
          type="search"
          placeholder="Title, description or tag"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading…</p>}

      {data && data.results.length > 0 && (
        <QuizList
          quizzes={data.results}
          onDelete={(quiz) => void handleDelete(quiz)}
          onHost={(quiz) => void handleHost(quiz)}
          hostingId={hostingId}
        />
      )}
      {data && data.results.length === 0 && !loading && !error && (
        <p className="muted">
          {search ? `No quizzes match "${search}".` : "You haven't created any quizzes yet."}
        </p>
      )}

      {data && (data.previous || data.next) && (
        <nav className="pagination" aria-label="Quiz pages">
          <button
            type="button"
            className="secondary"
            onClick={() => setPage(page - 1)}
            disabled={!data.previous || loading}
          >
            Previous
          </button>
          <span>
            Page {page} · {data.count} quizzes
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
