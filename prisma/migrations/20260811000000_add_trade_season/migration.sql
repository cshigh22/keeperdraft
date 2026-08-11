-- Add season stamp to trades so trade history can be scoped per league season.
-- Idempotent: safe to run against a database where the column was already
-- added out-of-band (dev uses db push while servers are running).
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "season" INTEGER;

-- Backfill existing trades with their league's current season. Correct for
-- leagues that have never rolled over (all trades to date happened in the
-- current season); scoped to NULL so re-runs and already-stamped rows are
-- untouched.
UPDATE "Trade" t
SET "season" = l."season"
FROM "League" l
WHERE t."leagueId" = l."id"
  AND t."season" IS NULL;
