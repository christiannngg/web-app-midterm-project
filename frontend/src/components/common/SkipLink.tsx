import type { MouseEvent } from "react";

/**
 * First thing a keyboard user tabs to: jumps past the page header to the main content.
 * Every page renders its own <main>, so the target is looked up when the link is used.
 */
export default function SkipLink() {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const main = document.querySelector("main");
    if (!main) return;
    e.preventDefault();
    main.setAttribute("tabindex", "-1");
    main.focus();
  };
  return (
    <a className="skip-link" href="#main" onClick={handleClick}>
      Skip to main content
    </a>
  );
}
