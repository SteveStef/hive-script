-- Tutorial progress: the lessons each player has finished. Nothing is locked by it; it only shows checkmarks.
CREATE TABLE tutorial (
  user_id int NOT NULL REFERENCES users ON DELETE CASCADE,
  lesson text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson)
);
