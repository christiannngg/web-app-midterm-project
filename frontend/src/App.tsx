import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { restoreSession } from "@/api/auth";
import RequireHost from "@/components/auth/RequireHost";
import ErrorBoundary from "@/components/common/ErrorBoundary";
import RouteAnnouncer from "@/components/common/RouteAnnouncer";
import SkipLink from "@/components/common/SkipLink";
import Toaster from "@/components/common/Toaster";
import HistoryPage from "@/pages/HistoryPage";
import HomePage from "@/pages/HomePage";
import HostPage from "@/pages/HostPage";
import LoginPage from "@/pages/LoginPage";
import NotFoundPage from "@/pages/NotFoundPage";
import PlayPage from "@/pages/PlayPage";
import QuizBuilderPage from "@/pages/QuizBuilderPage";
import QuizListPage from "@/pages/QuizListPage";
import ResultsPage from "@/pages/ResultsPage";
import { useAuthStore } from "@/store/authStore";

export default function App() {
  const ready = useAuthStore((s) => s.ready);
  const { pathname } = useLocation();

  useEffect(() => {
    void restoreSession();
  }, []);

  // Wait for the silent sign-in so pages never flash the signed-out state.
  if (!ready) {
    return (
      <>
        <main>
          <p role="status">Loading…</p>
        </main>
        <Toaster />
      </>
    );
  }

  return (
    <>
      <SkipLink />
      {/* Keyed by path: moving to another page remounts the boundary and clears a crash. */}
      <ErrorBoundary key={pathname}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/quizzes" element={<RequireHost><QuizListPage /></RequireHost>} />
          <Route path="/quizzes/new" element={<RequireHost><QuizBuilderPage /></RequireHost>} />
          <Route path="/quizzes/:id/edit" element={<RequireHost><QuizBuilderPage /></RequireHost>} />
          <Route path="/host/:code" element={<RequireHost><HostPage /></RequireHost>} />
          <Route path="/history" element={<RequireHost><HistoryPage /></RequireHost>} />
          <Route path="/history/:code" element={<RequireHost><ResultsPage /></RequireHost>} />
          <Route path="/play/:code" element={<PlayPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ErrorBoundary>
      <RouteAnnouncer />
      <Toaster />
    </>
  );
}
