# Demo script

About ten minutes. Everything here works with the seeded data, so you can start from a clean
database (`python manage.py migrate && python manage.py seed_demo --reset`).

## Set up before you start

- `docker compose up -d`, backend on :8000, frontend on :5173 (see the README).
- Two browser windows side by side for the players: one normal, one private/incognito, so each has
  its own session. The host uses a third window (or your main one).
- Optional: a phone or a third window as a second player.

Accounts: `demo_host` and `demo_player`, password `trivia-demo-123`.

---

## 1. Host signs in and looks at the quizzes (1 min)

1. Open `http://localhost:5173/login` and sign in as `demo_host`.
2. Open **My quizzes**. Point out: two published quizzes and one draft, tags, question counts.
3. Type `web` in the search box: the list narrows (search covers title, description and tags).

*Talking point:* the list is paginated and loads a constant number of queries however many
questions a quiz has (`prefetch_related`, tested).

## 2. Show quiz validation (1 min)

1. **New quiz**, leave everything empty and press **Create quiz**. The server's 400 errors appear
   *next to* the fields they belong to (title, question text, each blank choice) and focus jumps
   to the first one.
2. Fill in a title, tick **Published** and remove the only question: publishing needs at least one
   question. (The editor stops you going below two choices per question, and the server enforces
   "at least two choices, exactly one correct" regardless; the API tests cover both.)

*Talking point:* validation lives in the DRF serializers; the frontend only displays the dotted
error paths (like `questions.0.choices.1.text`).

## 3. Open a lobby (1 min)

1. On **My quizzes**, press **Host game** on "World Capitals".
2. The lobby shows a large join code. Say it out loud: no 0/O/1/I, easy to read from a projector.

## 4. Players join (2 min)

1. Window A (no sign-in needed): home page, enter the code and the nickname `Ana`.
2. Window B (private window): join as `Ben`. Both show up in both lobbies and on the host's screen.
3. Try joining as `ana` again: "nickname is taken" shown on the field (case-insensitive).
4. Host: **Lock lobby**. Try a third join: refused. **Unlock lobby**.
5. Host: **Kick** a throwaway third player; show that the kicked player's screen says so and that
   the same nickname cannot rejoin.

*Talking point (rooms):* one Redis group per code. Open a second game in another tab and show that
its players never appear in the first lobby.

## 5. Play a game (3 min)

1. Host presses **Start game**. Questions appear on all screens at the same time; the countdown is
   computed from the server's start time, so both windows agree even if one laptop's clock is off.
2. Ana answers fast, Ben waits. Show "1 of 2 players answered" on the host screen, the locked-in
   answer, and that a second tap is ignored.
3. After the reveal: the right answer is marked with text (not just colour), points earned are shown
   (+ speed bonus), and the leaderboard updates.
4. Let one question run out of time to show "Time's up" with no points.
5. After the last question the podium appears.

*Talking point (scoring):* the answer is written inside `transaction.atomic` with
`select_for_update` on the player row and `F("score") + points`. The test fires many answers at
once and checks that no points are lost.

## 6. Break the network on purpose (1 min)

Do this during a question.

1. In Ben's window open the browser dev tools, **Network**, set throttling to **Offline**.
2. The banner says "Connection lost. Reconnecting…" and the question stays on screen.
3. Set it back to **No throttling**. The banner clears, a "Back online." toast appears, and the
   window is on the *current* question again, with its earlier answer still locked in.

*Talking point:* exponential backoff with jitter (1 s up to 15 s), a heartbeat to catch half-dead
connections, and the server rebuilds the current state from the database on every new socket.

## 7. History and CSV (1 min)

1. Host: **Full results and CSV** (or **Game history** from the quiz list). The finished game is
   at the top, with the winner.
2. Open it: final standings table, then a per-question breakdown showing how many picked each
   choice.
3. **Download CSV**: one row per player per question. Open it in a spreadsheet.
4. Open the seeded games from the list too: they have more players.

*Talking point:* only the host who ran a game can see it (someone else's game is a 404).

## 8. Errors and accessibility (1 min)

- **Errors:** open `/history/NOPE12` for a clean "not found"; sign out and open `/quizzes`
  for the redirect to the login page; stop the backend and press a button to see the "can't reach
  the server" toast.
- **Keyboard only:** press Tab once on any page to reveal **Skip to main content**. Join a game and
  answer with Tab and Enter. Every page changes the tab title and moves focus to the new page.
- **Screen reader:** the question is read out when it appears, with spoken warnings at 10 seconds
  and for the last 5 seconds.

---

## If something goes wrong

| Symptom                              | Fix                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Lobby never shows players            | `docker compose ps`: is Redis up? Check `VITE_WS_URL` in `frontend/.env`|
| "Host game" button missing           | The quiz is a draft: publish it first                                   |
| Login page says wrong password       | Re-run `python manage.py seed_demo --reset`                             |
| Game stalls after restarting backend | Reload the host or a player page: the timer restarts on reconnect       |
| Need a clean slate                   | `python manage.py seed_demo --reset` (leaves your own accounts alone)   |
