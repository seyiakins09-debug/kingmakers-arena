# KINGMAKERS ARENA — Royal Treasury Strategic Upgrade

A strategic upgrade for the existing KINGMAKERS ARENA multiplayer app (Node.js + Express + PostgreSQL, Render).

## What's included
- Preserves the original 10-set / 100-level challenge library and its scenario titles.
- Host-controlled set progression: **START SET** opens Level 1; after host approval, **NEXT LEVEL** opens the next level. The host chooses the next set after Level 10.
- Multi-phase decisions at each level: Core Royal Decision, Strategic Policy, Operations & Execution, and Protection & Risk.
- Kingdom assets persist across levels: food reserve, infrastructure, stability, trade power, military readiness, and insurance.
- A shared hidden market event is generated and stored server-side when a set/level opens. All players in that level face the same event; only a limited signal is shown before reveal.
- Server-side financial outcome calculations use the player’s current kingdom assets, selected phases, risk posture, and the stored market event. The host sees and approves results; approved results apply once.
- Optional Royal Intelligence purchases (₦5m / ₦15m), one purchase per player per level. Intelligence is a clue, not a guaranteed outcome. Purchase is deducted immediately and included in the result accounting.
- Existing player registration/approval, login/access codes, session persistence, leaderboard, history, reveal/approval controls, and immediate host reset are retained.
- Additive PostgreSQL migrations use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; existing database and accounts are not dropped.

## Render deployment (existing app)
1. Back up your GitHub repository before replacing files.
2. Copy the upgraded `server.js`, `challenges.json`, `package.json`, and `public/index.html` into the existing repository, preserving the `public/` folder structure.
3. Commit and push to the same deployed branch. Render will deploy from GitHub.
4. Keep your existing Render environment variables and PostgreSQL database unchanged: `DATABASE_URL`, `JWT_SECRET`, and `HOST_PASSWORD`.
5. Do **not** delete/recreate the Render database or change secrets for this update. On startup, the server runs additive migrations.
6. After deployment, visit `/api/health`. Sign in as host and verify current registrations and leaderboard remain.

## Host gameplay
- Approve players as before.
- Select a set (1–10) and press **START SET**. This opens Level 1 for every player.
- Players submit one private multi-phase plan.
- Lock submissions → Reveal Decisions → Approve & Calculate Results.
- After results are approved, press **NEXT LEVEL**. It opens the next level for everyone.
- After Level 10 is approved, choose another set and press **START SET**.
- The final level (Set 10 / Level 10) marks the game complete.
- Reset Entire Game remains destructive to game participants/progress by design. It does not delete the database schema.

## Notes / validation
- `node --check server.js` and browser-script syntax checks pass for the delivered files.
- A live PostgreSQL/Render integration test was not run in this build environment. Please deploy to a staging copy first if possible, then test with a few test accounts before your real game night.
- Do not commit secrets or database URLs to GitHub.

## Player choice + host set selection fix (November 2026)
- Player form selections (core decision, policy, operations, protection) now persist through the automatic 3.5-second refresh instead of resetting to the first dropdown option.
- Intelligence purchase clue/cost state is preserved during refresh.
- The core decision options are displayed directly under Phase 1 at the top of the decision form.
- Host set selection no longer gets overwritten by the live dashboard refresh. Selecting Set 2–10 and clicking START SET keeps that set selected and starts it.
- Selections are reset for a new level rather than carrying choices across levels.
