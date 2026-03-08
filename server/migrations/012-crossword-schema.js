export async function up(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS crossword`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS crossword.puzzle_state (
      puzzle_date TEXT PRIMARY KEY,
      user_grid   JSONB NOT NULL,
      timer_seconds INTEGER DEFAULT 0,
      cell_fillers  JSONB DEFAULT '{}',
      points        JSONB DEFAULT '{}',
      guesses       JSONB DEFAULT '{}',
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS crossword.puzzles (
      date       TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS crossword.metadata (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS crossword.users (
      ip         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL,
      device_id  TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS crossword_users_device_id_idx
      ON crossword.users (device_id) WHERE device_id IS NOT NULL
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS crossword.jeopardy_games (
      game_id     TEXT PRIMARY KEY,
      show_number TEXT,
      air_date    TEXT,
      season      INTEGER,
      data        JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS crossword_jeopardy_games_air_date_idx
      ON crossword.jeopardy_games (air_date)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS crossword_jeopardy_games_season_idx
      ON crossword.jeopardy_games (season)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS crossword.jeopardy_progress (
      game_id        TEXT PRIMARY KEY,
      clues_answered INTEGER DEFAULT 0,
      total_clues    INTEGER DEFAULT 60,
      current_round  TEXT DEFAULT 'jeopardy',
      completed      BOOLEAN DEFAULT FALSE,
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
