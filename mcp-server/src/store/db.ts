import postgres from "postgres";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { config } from "../config.js";

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

let _sql: postgres.Sql | null = null;

function getConnection(): postgres.Sql {
  if (_sql !== null) return _sql;

  if (!config.database.url) {
    throw new Error(
      "DATABASE_URL is not configured. " +
      "Set DATABASE_URL=postgresql://chess:chess@localhost:5432/chess_context " +
      "and run: docker compose up -d postgres"
    );
  }

  _sql = postgres(config.database.url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });

  return _sql;
}

export function sql(): postgres.Sql {
  return getConnection();
}

export function isDbConfigured(): boolean {
  return config.database.url !== null;
}

// ---------------------------------------------------------------------------
// Migration — apply schema.sql on startup
// ---------------------------------------------------------------------------

const schemaPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "schema.sql"
);

export async function migrate(): Promise<void> {
  const db = getConnection();
  const ddl = readFileSync(schemaPath, "utf8");
  await db.unsafe(ddl);
  console.error("[ChessContext] Database schema applied.");
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}
