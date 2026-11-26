import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import type { D1Database, D1PreparedStatement } from "../../src/lib/db/types.ts";

type BoundStatement = { sql: string; values: unknown[] };

class Prepared implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly owner: SqliteD1;
  private readonly sql: string;
  constructor(owner: SqliteD1, sql: string) { this.owner = owner; this.sql = sql; }
  bind(...values: unknown[]) { const statement = new Prepared(this.owner, this.sql); statement.values = values; return statement; }
  first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.owner.db.prepare(this.sql).get(...this.values as never[]) as Record<string, unknown> | undefined;
    return Promise.resolve(column ? (row?.[column] as T | undefined) ?? null : (row as T | undefined) ?? null);
  }
  all<T = Record<string, unknown>>() {
    const results = this.owner.db.prepare(this.sql).all(...this.values as never[]) as T[];
    return Promise.resolve({ results, success: true, meta: this.owner.meta(this.sql) });
  }
  raw<T extends unknown[] = unknown[]>() {
    const statement = this.owner.db.prepare(this.sql);
    statement.setReturnArrays(true);
    const results = statement.all(...this.values as never[]) as unknown as T[];
    return Promise.resolve(results);
  }
  run() {
    const result = this.owner.db.prepare(this.sql).run(...this.values as never[]) as { changes?: number };
    return Promise.resolve({ success: true, meta: { ...this.owner.meta(this.sql), changes: Number(result.changes ?? 0) } });
  }
  statement(): BoundStatement { return { sql: this.sql, values: this.values }; }
}

export class SqliteD1 implements D1Database {
  readonly db: DatabaseSync;
  readonly statements: BoundStatement[] = [];
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON");
  }
  prepare(query: string) {
    const prepared = new Prepared(this, query);
    this.statements.push(prepared.statement());
    return prepared;
  }
  async batch(statements: readonly D1PreparedStatement[]) {
    this.db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements as Prepared[]) results.push(await statement.run());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  meta(query: string) {
    try {
      const plan = this.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as Array<{ detail?: string }>;
      return { rows_read: plan.length, rows_written: /\b(INSERT|UPDATE|DELETE)\b/i.test(query) ? 1 : 0, query_plan: plan.map((item) => item.detail) };
    } catch { return { rows_read: 0, rows_written: 0 }; }
  }
  applyMigration(path = "migrations/0000_init.sql") {
    const paths = path === "migrations/0000_init.sql"
      ? readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort().map((name) => `migrations/${name}`)
      : [path];
    for (const migrationPath of paths) {
      const migration = readFileSync(migrationPath, "utf8");
      for (const statement of migration.split(/--> statement-breakpoint\s*/).map((part) => part.trim()).filter(Boolean)) this.db.exec(statement);
    }
  }
  close() { this.db.close(); }
}
