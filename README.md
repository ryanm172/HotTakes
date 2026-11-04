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

1. Create a new project at https://supabase.com/dashboard. Save the database password in your password manager; the app does not need it.
2. In **Authentication → Sign In / Providers**, enable **Anonymous Sign-Ins**. Dashboard wording may vary. Players receive a saved anonymous session without entering email or password. 
3. In **SQL Editor**, run the contents of `supabase/migrations/001_hot_takes.sql` once. Use a new project, not one containing unrelated app data. This creates private game storage and the `hot_game` RPC.
4. Find your project URL and **publishable** key in the project's Connect/API settings. The legacy `anon` key also works. Never use a secret or service-role key in the frontend.
5. Copy `.env.example` to `.env.local` and replace both placeholders:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

6. Restart the dev server. Host a room, then join with three more independent browser profiles/devices. Regular tabs in the same browser profile share one saved player identity; use separate profiles or browsers to test different players.

Anonymous sessions let someone reconnect on the same browser/device. Explicit Leave in the lobby removes the player immediately; during a game it saves their spot and offers Return to game. Clearing site data or changing devices loses that identity. Since voting waits for every original voter, that can leave a game stuck; create a new room in that case.

Official references: [anonymous auth](https://supabase.com/docs/guides/auth/auth-anonymous), [database functions](https://supabase.com/docs/guides/database/functions).

## Test on your iPhone

- Put the PC and iPhone on the same Wi-Fi.
- Start `dev.ps1`; open the printed **Network** URL in Safari, such as `http://192.168.1.20:5173`. `localhost` on your phone points to the phone, not your PC.
- If Windows Firewall asks, allow Node on your private home network. Avoid exposing the development server directly to the public internet.
- The online room state lives in Supabase, but every player must also be able to reach the frontend. For friends outside your Wi-Fi, deploy the static build to an HTTPS host.
- Test touch dragging, arrow reorder controls, the keyboard covering the answer field, backgrounding Safari, reconnecting, and host transfer. Reopening the same URL restores the saved room automatically.

## Hosting later

### AWS Amplify Hosting

The root `amplify.yml` installs Node 22, installs dependencies from the lockfile, runs game/database tests, builds the frontend, and publishes `dist`. It does not provision an AWS backend; Supabase remains the backend.

1. Push this project, including `amplify.yml`, to a GitHub repository. The initial local Git repository has no remote configured yet; finish the GitHub upload before connecting Amplify.
2. In the [AWS Amplify console](https://console.aws.amazon.com/amplify/), create a new app and choose GitHub as the source. Authorize the AWS Amplify GitHub App for this repository, select the repository and `main` branch, and continue.
3. Use the checked-in `amplify.yml` for build settings. Choose the Amazon Linux 2023 build image if asked. There is no Amplify backend or Amplify CLI initialization step for this app.
4. In the setup wizard's advanced settings, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using the values from your Supabase project. If they are not available in the wizard, add them under Hosting → Environment variables after creation, then redeploy. Do not upload `.env.local` or use a secret/service-role key.
5. Save and deploy. Open the generated HTTPS `amplifyapp.com` URL. Check that host/join works with four independent browser profiles/devices. A successful website build does not mean the Supabase migration or anonymous authentication is configured.
6. After testing, open Hosting → Custom domains and add your purchased domain. Follow Amplify's DNS instructions at your domain provider and wait for domain verification and the HTTPS certificate. Route 53 is optional; you can keep your current registrar and DNS provider.

Later pushes to the connected branch trigger new builds. Environment variable changes require a new build because Vite embeds these values into the frontend. Check AWS pricing and set a billing budget for the account before leaving hosting running.

References: [GitHub connection](https://docs.aws.amazon.com/amplify/latest/userguide/setting-up-GitHub-access.html), [environment variables](https://docs.aws.amazon.com/amplify/latest/userguide/setting-env-vars.html), [custom domains](https://docs.aws.amazon.com/amplify/latest/userguide/custom-domains.html).

### Other static hosts

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

This is a small private-play MVP. Before wider public release, add abuse/rate controls for anonymous room creation, retention/cleanup for old rooms, and live multi-device testing. Rooms expire after one hour without member activity; automatic deletion requires the Cron migration below. Anonymous auth users have a separate lifecycle and are not deleted by room cleanup. The included backend tests do not replace a live Supabase authentication/network test.

## A useful AI development loop

Ask for one small change, inspect the diff, run the tests, then try the affected flow yourself. For example: “Add a copy-invite-link button without changing the game rules.” Keep the brief updated when changing rules, especially timers, ties, or missing-player behavior.

## Room lifecycle migration (existing Supabase projects)

### Player mascot badges

After migration 004, apply `supabase/migrations/20261104204041_player_badges.sql`
before deploying the badge frontend. It validates the eight badge IDs, adds the
`badge` action to `hot_game`, saves choices in each room's player state, and includes
badges in named player snapshots, revealed results, and scored-round highlights.
Badge changes use the same room lock as starting the game, so a late save cannot
change an icon after play begins. Existing players without a saved badge display
Hot Sauce. Badges never appear in anonymous answer payloads.

Choose an icon beside the nickname, or tap your own avatar in a lobby to change it.
Selections save immediately; a failed save retains the previous choice. The browser
remembers successful choices in `hot-badge`. Practice runs the same picker locally.
The eight illustrated mascots are shipped in `public/badges/hot-mascots.png`, a 4×2
sprite sheet displayed by the shared `Badge` component. No external image service
or uploaded player images are needed.

### Game recap update

After the lifecycle migrations below, run `supabase/migrations/004_game_recap.sql`
once in the SQL Editor before deploying the updated frontend. Start a fresh room to
test it; earlier test games do not have full round history and are not backfilled.
Migration 004 does not change the existing cleanup schedule or retention window.

After the fifth round's normal results, choose **View game recap** for the winners,
ranked final scoreboard, and hottest answer(s) from each scored round. Highlights
include exact ties and show the prompt, answer, and author. Practice mode also saves
all five highlights locally. View last results opens the recap directly; refreshing
an opened recap preserves the selected view in that browser tab.

Apply these SQL files in order in the Supabase SQL Editor, before deploying the updated frontend:

1. `supabase/migrations/002_room_lifecycle.sql` adds activity tracking, explicit departure,
   return, expiry checks, and the private cleanup function. It preserves the existing
   scoring implementation. Existing rooms inherit their latest player heartbeat and
   may already be expired. Run this migration once, after `001_hot_takes.sql`.
2. Enable **Integrations → Cron** (`pg_cron`) in the Supabase dashboard.
3. Run `supabase/migrations/003_schedule_room_cleanup.sql`. It schedules
   `hot-takes-room-cleanup` every five minutes. Reapplying this schedule updates the
   named job rather than creating a duplicate.
4. Check the job and its run history in **Integrations → Cron**. For an immediate
   cleanup, an administrator can run `select hot_private.cleanup_rooms();`.

New projects need all three migrations in order. Do not rerun migration 001 on an
existing project. The embedded database tests apply 001 and 002 and invoke cleanup
manually; they do not run the Supabase-only Cron extension.

A lobby player loses their slot after ten minutes without contact. A room expires
at one hour without successful member requests, including polling; access is denied
at that cutoff even before the next scheduled deletion. Cleanup may delete an empty
lobby earlier. Explicit host departure closes a lobby if nobody else is connected.
Active-game departures preserve the roster, answers, ballots and scores; voting still
waits for every original player. Finished games retain results for the same inactivity
window. Closing a tab is treated as a disconnect, not an explicit Leave.

The Return to game link is saved on the same browser/device and removed when a player
joins/creates another room or attempts to return to an unavailable room. Viewing an
open room, including finished results, refreshes its inactivity clock. A failed Leave
allows retry or Leave on this device; the latter cannot guarantee server departure.

After deployment, verify with independent browser profiles/devices: last-player lobby
exit, host transfer, active-game leave/return, and voting with a temporarily absent
player. Also verify the Cron job records successful runs. Browser tests mock the
network boundary; live Supabase and Cron operation still require these checks.

Supabase references: [Cron installation](https://supabase.com/docs/guides/cron/install),
[scheduling and monitoring](https://supabase.com/docs/guides/cron/quickstart).
