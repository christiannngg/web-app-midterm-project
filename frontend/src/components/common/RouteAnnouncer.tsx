import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { pageTitleFor } from "@/utils/pageTitle";

/**
 * A single-page app never reloads, so the browser doesn't tell a screen reader that the page
 * changed. On every navigation this sets the document title and moves focus to <main>, which makes
 * a screen reader read the new page from the top. It renders nothing, and it leaves the first
 * page load alone (the browser already announces that).
 */
export default function RouteAnnouncer() {
  const { pathname } = useLocation();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    document.title = pageTitleFor(pathname);
    const previous = lastPath.current;
    lastPath.current = pathname;
    if (previous === null || previous === pathname) return; // first load (or a StrictMode re-run)
    const main = document.querySelector("main");
    if (main) {
      main.setAttribute("tabindex", "-1");
      main.focus();
    }
  }, [pathname]);

  return null;
}
