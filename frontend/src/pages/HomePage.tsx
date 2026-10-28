import { Link } from "react-router-dom";
import { signOut } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";

// Join a game / host login entry
export default function HomePage() {
  const user = useAuthStore((s) => s.user);
  return (
    <main className="home">
      <h1>Trivia Tournament</h1>
      {user ? (
        <>
          <p>
            Signed in as <strong>{user.username}</strong> ({user.role}).
          </p>
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </>
      ) : (
        <p>
          <Link to="/login">Sign in or create an account</Link>
        </p>
      )}
    </main>
  );
}
