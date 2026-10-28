import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { restoreSession } from "@/api/auth";
import HomePage from "@/pages/HomePage";
import HostPage from "@/pages/HostPage";
import LoginPage from "@/pages/LoginPage";
import PlayPage from "@/pages/PlayPage";
import { useAuthStore } from "@/store/authStore";

export default function App() {
  const ready = useAuthStore((s) => s.ready);

  useEffect(() => {
    void restoreSession();
  }, []);

  // Wait for the silent sign-in so pages never flash the signed-out state.
  if (!ready) return <p role="status">Loading…</p>;

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/host/:code" element={<HostPage />} />
      <Route path="/play/:code" element={<PlayPage />} />
    </Routes>
  );
}
