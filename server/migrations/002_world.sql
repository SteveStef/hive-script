-- Phase 3: shared worlds of 5x5 maps. A world runs every colony on it together, and a
-- colony is one player's hive on one map of a world.

CREATE TABLE worlds (
  id serial PRIMARY KEY,
  seed int NOT NULL,
  state jsonb NOT NULL, -- World.save(): the land, its flowers and every colony on it
  tick int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Phase 2's colonies were each a world of their own and don't carry over: their players pick a map.
DROP TABLE colonies;
CREATE TABLE colonies (
  user_id int PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  world_id int NOT NULL REFERENCES worlds ON DELETE CASCADE,
  colony_id int NOT NULL, -- the colony's id inside its world's saved state
  map_x int NOT NULL,
  map_y int NOT NULL,
  founded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, map_x, map_y),
  UNIQUE (world_id, colony_id)
);

-- The world a player belongs to; they found every colony there while it has a free map.
ALTER TABLE users ADD COLUMN world_id int REFERENCES worlds ON DELETE SET NULL;
