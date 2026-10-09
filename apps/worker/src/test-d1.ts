/**
 * Test-only D1 shim over Node's embedded SQLite (`node:sqlite`).
 *
 * Production code talks to the `D1Database` interface (Cloudflare D1). No `@cloudflare/vitest-pool-workers`
 * harness is installed in this repo, so ledger tests execute the real migration SQL and the real prepared
 * statements against node:sqlite — the same SQLite engine family D1 runs — in-process, with no workerd.
 * Only tests import this module; nothing in `src/` production code does.
 *
 * The `node:sqlite` / `node:fs` declarations this relies on live in `src/node-builtins.d.ts`.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export interface D1MetaLite {
  changes: number;
  last_row_id: number;
}

/** Mirrors the subset of `D1PreparedStatement` that `postEntry` / `reverseEntry` use. */
export class TestStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[],
  ) {}

  bind(...values: unknown[]): TestStatement {
    return new TestStatement(this.db, this.sql, values.map((v) => (v === undefined ? null : v)));
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: D1MetaLite }> {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results: rows, success: true, meta: { changes: 0, last_row_id: 0 } };
  }

  async run(): Promise<{ results: never[]; success: true; meta: D1MetaLite }> {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

/** Mirrors the subset of `D1Database` used by the ledger, including batch atomicity. */
export interface TestD1 {
  prepare(sql: string): TestStatement;
  batch(statements: TestStatement[]): Promise<unknown[]>;
  exec(sql: string): void;
  close(): void;
}

/** Fresh in-memory ledger database with every migration applied, in filename order. */
export function createLedgerDb(): TestD1 {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const here = (import.meta as unknown as { url: string }).url;
  for (const file of ["0001_init.sql", "0002_journal_approver.sql", "0003_audit.sql"]) {
    db.exec(readFileSync(new URL(`../migrations/${file}`, here), "utf8"));
  }
  return {
    prepare: (sql) => new TestStatement(db, sql, []),
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results: unknown[] = [];
        for (const s of statements) results.push(await s.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
  };
}
