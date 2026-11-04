# Hot Takes

A mobile-first party game built with React, TypeScript, Vite, and Supabase. Local development on Windows; play in Safari on iPhone. See [GAME-BRIEF.md](GAME-BRIEF.md) for the agreed rules.

## Run it now

Dependencies are installed in this workspace. PowerShell:

```powershell
.\dev.ps1
```

Open the Local URL printed in the terminal (normally http://localhost:5173). Choose **Try a practice game** to play through five rounds with simulated players. Practice is explicitly labeled and does not use Supabase.

`dev.ps1` uses the project-local Node 22 runtime in `.tools` when present, otherwise your system Node. For a fresh checkout, install Node **22.12+** and run `npm ci`, then `npm run dev`. `.tools` and dependencies are not committed.

```powershell
.\dev.ps1 build
.\dev.ps1 test
.\dev.ps1 preview
```

Browser checks use installed Chrome. Start the dev server in one terminal, then run `npm run test:browser` in another (requires Node 22.12+). On this PC you can instead run `& '.\.tools\node_modules\node\bin\node.exe' '.\node_modules\@playwright\test\cli.js' test`. These checks assume no Supabase environment values are configured and exercise the labeled practice mode. Screenshots are written to the ignored `artifacts/` folder.

## Connect real multiplayer

1. Create a new project at https://supabase.com/dashboard. Save the database password in your password manager; the app does not need it. Password: py2wwzCa2tyRvESl
2. In **Authentication → Sign In / Providers**, enable **Anonymous Sign-Ins**. Dashboard wording may vary. Players receive a saved anonymous session without entering email or password. 
3. In **SQL Editor**, run the contents of `supabase/migrations/001_hot_takes.sql` once. Use a new project, not one containing unrelated app data. This creates private game storage and the `hot_game` RPC.
4. Find your project URL and **publishable** key in the project's Connect/API settings. The legacy `anon` key also works. Never use a secret or service-role key in the frontend.
5. Copy `.env.example` to `.env.local` and replace both placeholders:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

6. Restart the dev server. Host a room, then join with three more independent browser profiles/devices. Regular tabs in the same browser profile share one saved player identity; use separate profiles or browsers to test different players.

Anonymous sessions let someone reconnect on the same browser/device. Clearing site data or changing devices loses that identity. Since voting waits for every original voter, that can leave a game stuck; create a new room in that case.

Official references: [anonymous auth](https://supabase.com/docs/guides/auth/auth-anonymous), [database functions](https://supabase.com/docs/guides/database/functions).

## Test on your iPhone

- Put the PC and iPhone on the same Wi-Fi.
- Start `dev.ps1`; open the printed **Network** URL in Safari, such as `http://192.168.1.20:5173`. `localhost` on your phone points to the phone, not your PC.
- If Windows Firewall asks, allow Node on your private home network. Avoid exposing the development server directly to the public internet.
- The online room state lives in Supabase, but every player must also be able to reach the frontend. For friends outside your Wi-Fi, deploy the static build to an HTTPS host.
- Test touch dragging, arrow reorder controls, the keyboard covering the answer field, backgrounding Safari, reconnecting, and host transfer. Reopening the same URL restores the saved room automatically.

## Hosting later

Build with `npm run build` (or `dev.ps1 build` on this PC). The output is `dist/`. Use a static host such as Cloudflare Pages, Netlify, or Vercel. Configure the two `VITE_` environment values before building; they are public frontend configuration. With Git-based hosting use `npm run build` and output directory `dist`. Select Node 22.12+.

For a manual upload, build locally after configuring `.env.local`, then upload `dist`. The frontend URL must stay stable to preserve browser identity. In Safari, use Share → Add to Home Screen to give it an app-like launch icon. The app still requires an internet connection; there is no offline game mode or service-worker cache.

Nothing has been published or connected to a cloud project by this setup.

## How the multiplayer code works

- `src/App.tsx`: responsive UI, room flow, accessible touch/keyboard ranking, and isolated practice mode.
- `src/api.ts`: anonymous authentication and the game RPC.
- `src/game.ts`: types and a rational-arithmetic scoring reference for practice/tests.
- `supabase/migrations/001_hot_takes.sql`: the authoritative room state machine, sanitized snapshots, and scoring.
- `tests/database.test.ts`: runs the actual migration in embedded PostgreSQL, with a stub of Supabase's JWT identity function. It does not need a live project.

Each room operation locks its database row, validates membership and action, applies deadlines, and returns only data visible to that player. Answer authors and submitted ballots stay server-side until results (ballots are never returned). Authenticated clients cannot read or write the private schema directly. Score units are integers so tied scores are not determined by display rounding.

For this turn-based MVP, clients synchronize every 2.5 seconds using the RPC. This deliberately uses polling rather than Supabase Realtime subscriptions; it also acts as the heartbeat for host transfer. The server checks the answer deadline before accepting writes. If every client is closed, phase processing resumes on the next request, using the original deadline. Host disconnection is detected through missed heartbeats, so transfer occurs after about 30 seconds plus network/polling delay. Backgrounded mobile browsers may be treated as disconnected, but still owe their votes.

This is a small private-play MVP. Before wider public release, add abuse/rate controls for anonymous room creation, retention/cleanup for old rooms, and live multi-device testing. Rooms and anonymous users currently persist until an administrator removes them. The included backend tests do not replace a live Supabase authentication/network test.

## A useful AI development loop

Ask for one small change, inspect the diff, run the tests, then try the affected flow yourself. For example: “Add a copy-invite-link button without changing the game rules.” Keep the brief updated when changing rules, especially timers, ties, or missing-player behavior.
