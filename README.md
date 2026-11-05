# KINGMAKERS ARENA — Royal Treasury Strategic Upgrade + Royal Crisis System

Node.js + Express + PostgreSQL multiplayer game for Render.

## Added: Royal Crisis System

- A Royal Crisis checkpoint is due after Level 3, Level 6, and Level 9 of every set (30 potential checkpoints across 10 sets).
- The normal level must be approved first.
- The host can activate a prepared crisis or skip the checkpoint.
- Five crisis templates are included: Famine, Infrastructure Failure, Trade Blockade, Royal Epidemic, and Enemy Invasion.
- Host can edit the crisis title, description, resource requirements, and per-unit asset purchase prices before activation.
- Every player sees the same activated crisis.
- Players choose to purchase missing resources using their treasury or attempt the crisis with existing assets only.
- The host approves the outcome. Asset deductions, purchase costs, treasury rewards/penalties, XP, Crown Points, and failure damage are applied server-side.
- Crisis submissions and results are stored in PostgreSQL and displayed in the host dashboard and player history.
- NEXT LEVEL is blocked at a crisis checkpoint until the host activates and approves a crisis or explicitly skips it.

## Crisis flow

1. Complete Level 3, 6, or 9 and approve its normal results.
2. In **Royal Crisis Command**, select a template.
3. Edit the crisis title/description and required resource quantities/unit prices if desired.
4. Click **ACTIVATE CRISIS** to reveal it to all players.
5. Players submit either **Purchase missing assets** or **Use existing assets only**.
6. Click **Approve Crisis Results** to apply consequences once.
7. Click **NEXT LEVEL** to continue. Alternatively, use **Skip this crisis** before activation.

## Deployment to the existing Render project

1. Extract the ZIP.
2. Copy the contents of `kingmakers_arena_upgrade/` into the same GitHub repository connected to your existing KINGMAKERS ARENA Render service, replacing `server.js`, `public/index.html`, and `README.md`.
3. Keep `challenges.json` and `package.json` from this ZIP. The original 100 challenge scenarios and strategic choices are included.
4. Commit and push to the deployed branch. Render should redeploy automatically.
5. Keep the existing Render PostgreSQL database and all environment variables unchanged: `DATABASE_URL`, `JWT_SECRET`, and `HOST_PASSWORD`.
6. Do **not** delete/recreate the database. The server adds the crisis columns/tables using additive `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations.

## Important

- This package was syntax-checked locally (`node --check` for server and browser script) and the ZIP was verified.
- It has not been connected to or tested against your live Render PostgreSQL instance in this session. Test the crisis flow with a few test accounts before a live tournament.
- Keep database URLs, JWT secrets, and host passwords out of GitHub and screenshots.
