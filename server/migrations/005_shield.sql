-- A player's protection as a new colony runs for one window from their first colony in it, so
-- abandoning a colony and founding another can't reset it. shield_broken: their colony attacked
-- another player during the window, which ended the protection for the rest of it.
ALTER TABLE users ADD COLUMN shield_started_at timestamptz;
ALTER TABLE users ADD COLUMN shield_broken boolean NOT NULL DEFAULT false;
