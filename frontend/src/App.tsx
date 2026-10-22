import { Route, Routes } from "react-router-dom";
import HomePage from "@/pages/HomePage";
import HostPage from "@/pages/HostPage";
import LoginPage from "@/pages/LoginPage";
import PlayPage from "@/pages/PlayPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/host/:code" element={<HostPage />} />
      <Route path="/play/:code" element={<PlayPage />} />
    </Routes>
  );
}
