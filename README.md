# KINGMAKERS ARENA — Royal Treasury Multiplayer

Node.js + Express + PostgreSQL shared multiplayer game for Render.

## Deploy on Render
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Required environment variables: `DATABASE_URL`, `JWT_SECRET`, `HOST_PASSWORD`
- PostgreSQL is required. Use Render's Internal Database URL for `DATABASE_URL`.

## Live update added (November 2026)
- Host and player dashboards automatically refresh every 3.5 seconds while signed in.
- Registration requests, newly opened challenges, lock/reveal state, and approved results appear without manual refresh or repeated login.
- Login session is retained across page reloads; Sign out clears the saved session.
- Players see the revealed current challenge decisions/outcome preview after the host reveals. Final treasury/XP/Crown updates still occur only after host approval.

## Updating an existing Render deployment
Upload/replace `server.js` and `public/index.html` in the connected GitHub repository, commit to the deployed branch, then Render will auto-deploy. Keep `challenges.json`, `package.json`, and your Render environment variables/database unchanged.

## Security
Never commit database URLs, JWT secrets, or host passwords to GitHub. Set them only in Render Environment Variables.
