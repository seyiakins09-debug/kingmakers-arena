# KINGMAKERS ARENA — Royal Treasury (Multiplayer Web App)

This is the full Node.js + PostgreSQL multiplayer web application, not a browser-only prototype.

## Features
- Shared PostgreSQL database for all players on different phones/computers.
- Player registration and host approval.
- Permanent random player access codes (stored as bcrypt hashes).
- Server-side host password verification (set `HOST_PASSWORD` in Render; never put it in frontend code).
- 100 seeded challenges across 10 royal sets.
- Secret decisions, host lock/reveal, host-approved result calculation.
- Shared treasury, XP, Crown Points, leaderboard, player result history.
- Balance persistence across all sets; no overdraft; exact zero means eliminated.
- Full reset control clears registrations, access codes, balances, submissions, scores and resets challenge/night state.

## Deploy with GitHub + Render
1. Create a GitHub repository and upload **all files and folders** from this project (not only `index.html`).
2. In Render, choose **New → Blueprint** and connect the repository. Render reads `render.yaml` and creates the Node web service plus PostgreSQL database.
3. During setup, Render asks for `HOST_PASSWORD` because it is marked `sync: false`. Set a strong password and save it securely.
4. Deploy. Wait for the service to become Live, then open its Render URL.
5. Open the URL and select **Royal Host**. Sign in with the host password you set.
6. Players register using their names. Approve them in the host dashboard; the generated permanent access code appears once. Send each player their code privately.
7. Open the first challenge from the host dashboard. Players can then submit decisions from their own devices.

## Required environment variables
- `DATABASE_URL`: PostgreSQL connection string (Render Blueprint creates this automatically).
- `JWT_SECRET`: Render generates this automatically in Blueprint.
- `HOST_PASSWORD`: Set manually in Render environment settings.

## Game flow
Host: approve players → Open Game → open challenge → collect decisions → Lock Submissions → Reveal Decisions → Approve & Calculate Results → open next challenge.

Do not move to the next challenge until results have been approved. The host can reopen submissions before approval if a player needs to correct a decision.

## Notes / important
- The app requires PostgreSQL. Do not deploy as a static site; choose Render Blueprint or a Node Web Service with PostgreSQL.
- The included challenge option outcome table is server-side and is not sent to player browsers. Player views show option names, descriptions, and costs only.
- Challenge outcome values are predetermined in `challenges.json`; results are applied only once per player per challenge.
- For a public tournament, keep the host password private and use a strong value. Player access codes should be sent privately.
- Reset is destructive and clears all registrations and game progress. Use only when intentionally starting over.
