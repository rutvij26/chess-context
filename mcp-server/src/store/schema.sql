-- Chess Context game store schema
-- Applied automatically on startup via db.ts

CREATE TABLE IF NOT EXISTS player_games (
  id              SERIAL    PRIMARY KEY,
  platform        VARCHAR(20)  NOT NULL,
  username        VARCHAR(100) NOT NULL,
  game_id         VARCHAR(100) NOT NULL,
  pgn             TEXT         NOT NULL,
  time_control    VARCHAR(50),
  played_at       TIMESTAMPTZ,
  result          VARCHAR(10),
  opening_name    VARCHAR(200),
  opening_eco     VARCHAR(10),
  player_color    VARCHAR(10),
  opponent        VARCHAR(100),
  player_rating   INTEGER,
  opponent_rating INTEGER,
  fetched_at      TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(platform, username, game_id)
);

CREATE INDEX IF NOT EXISTS idx_player_games_user
  ON player_games(platform, username, played_at DESC);

CREATE TABLE IF NOT EXISTS game_analyses (
  id               SERIAL   PRIMARY KEY,
  player_game_id   BIGINT      NOT NULL REFERENCES player_games(id) ON DELETE CASCADE,
  schema_version   VARCHAR(10) NOT NULL DEFAULT '0.6',
  move_records     JSONB       NOT NULL,
  white_accuracy   NUMERIC(5,2),
  black_accuracy   NUMERIC(5,2),
  critical_moments JSONB,
  phase_breakdown  JSONB,
  patterns_detected TEXT[],
  analyzed_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_game_id)
);

CREATE INDEX IF NOT EXISTS idx_game_analyses_game
  ON game_analyses(player_game_id);

CREATE TABLE IF NOT EXISTS analysis_queue (
  id             SERIAL   PRIMARY KEY,
  player_game_id BIGINT      NOT NULL REFERENCES player_games(id) ON DELETE CASCADE,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  queued_at      TIMESTAMPTZ DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  error          TEXT,
  UNIQUE(player_game_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_queue_status
  ON analysis_queue(status, queued_at);
