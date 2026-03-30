import { createRequire } from "module";
import { homedir } from "os";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import type DatabaseConstructor from "better-sqlite3";
import type { UCIAnalysisLine } from "../types/index.js";

const require = createRequire(import.meta.url);

const MAX_ENTRIES = 10_000;

// ---------------------------------------------------------------------------
// Lazy-initialized state
// Deferred so that EVAL_CACHE_DB can be set by tests before first access.
// ---------------------------------------------------------------------------

type Db = DatabaseConstructor.Database;
type Stmt = DatabaseConstructor.Statement;

let _db: Db | null = null;
let _get: Stmt | null = null;
let _upsert: Stmt | null = null;
let _count: Stmt | null = null;
let _evict: Stmt | null = null;
let _touch: Stmt | null = null;

function openDb(): Db {
  if (_db) return _db;

  const dbPath =
    process.env["EVAL_CACHE_DB"] ??
    join(homedir(), ".chess-context", "eval-cache.db");

  mkdirSync(dirname(dbPath), { recursive: true });

  const Ctor = require("better-sqlite3") as typeof DatabaseConstructor;
  _db = new Ctor(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS position_evals (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      accessed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_accessed_at
      ON position_evals (accessed_at);
  `);

  _get = _db.prepare("SELECT value FROM position_evals WHERE key = ?");
  _upsert = _db.prepare(`
    INSERT INTO position_evals (key, value, accessed_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE
      SET value = excluded.value,
          accessed_at = excluded.accessed_at
  `);
  _count = _db.prepare("SELECT COUNT(*) AS count FROM position_evals");
  _evict = _db.prepare(`
    DELETE FROM position_evals
    WHERE key IN (
      SELECT key FROM position_evals
      ORDER BY accessed_at ASC
      LIMIT ?
    )
  `);
  _touch = _db.prepare(
    "UPDATE position_evals SET accessed_at = ? WHERE key = ?"
  );

  return _db;
}

export function getSqlitePositionEval(key: string): UCIAnalysisLine[] | undefined {
  openDb();
  const row = (_get as Stmt).get(key) as { value: string } | undefined;
  if (!row) return undefined;
  (_touch as Stmt).run(Date.now(), key);
  return JSON.parse(row.value) as UCIAnalysisLine[];
}

export function setSqlitePositionEval(
  key: string,
  lines: UCIAnalysisLine[]
): void {
  openDb();
  (_upsert as Stmt).run(key, JSON.stringify(lines), Date.now());
  const { count } = (_count as Stmt).get() as { count: number };
  if (count > MAX_ENTRIES) {
    (_evict as Stmt).run(count - MAX_ENTRIES);
  }
}

/** Close and reset the DB connection. Used in tests to swap DB paths. */
export function _closeDbForTest(): void {
  if (_db) {
    _db.close();
    _db = null;
    _get = null;
    _upsert = null;
    _count = null;
    _evict = null;
    _touch = null;
  }
}
