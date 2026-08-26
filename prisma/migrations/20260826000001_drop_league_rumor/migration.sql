-- Drop the abandoned LeagueRumor experiment table (created via db push, never
-- part of the schema). IF EXISTS keeps this a no-op on databases that never
-- had it.
DROP TABLE IF EXISTS "LeagueRumor";
