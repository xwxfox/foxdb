import type { BunDatabase, SQLQueryBindings } from "./database.ts";
import type { QueryMetrics } from "./types.ts";

export interface QueryExecutorOptions {
  db: BunDatabase;
  tableName: string;
  metricsHook?: (meta: QueryMetrics) => void;
}

export class QueryExecutor {
  private db: BunDatabase;
  private tableName: string;
  private metricsHook?: (meta: QueryMetrics) => void;
  private stmtCache = new Map<string, ReturnType<BunDatabase["prepare"]>>();

  constructor(opts: QueryExecutorOptions) {
    this.db = opts.db;
    this.tableName = opts.tableName;
    this.metricsHook = opts.metricsHook;
  }

  private _getStmt(sql: string) {
    const cached = this.stmtCache.get(sql);
    if (cached) return cached;
    const stmt = this.db.prepare(sql);
    this.stmtCache.set(sql, stmt);
    return stmt;
  }

  exec(
    sql: string,
    params?: SQLQueryBindings[],
    operation = "raw"
  ): { changes: number; lastInsertRowid: number | bigint } {
    const start = performance.now();
    const result = this._getStmt(sql).run(...(params ?? []));
    this._emit(operation, sql, performance.now() - start, result.changes);
    return result;
  }

  all<T>(sql: string, params?: SQLQueryBindings[], operation = "read"): T[] {
    const start = performance.now();
    const rows = this._getStmt(sql).all(...(params ?? [])) as T[];
    this._emit(operation, sql, performance.now() - start, rows.length);
    return rows;
  }

  get<T>(sql: string, params?: SQLQueryBindings[], operation = "read"): T | null {
    const start = performance.now();
    const row = this._getStmt(sql).get(...(params ?? [])) as T | undefined;
    this._emit(operation, sql, performance.now() - start, row ? 1 : 0);
    return row ?? null;
  }

  *iterate<T>(
    sql: string,
    params?: SQLQueryBindings[],
    operation = "read"
  ): Generator<T> {
    const start = performance.now();
    const iter = this._getStmt(sql)
      .iterate(...(params ?? [])) as IterableIterator<T>;
    let count = 0;
    for (const row of iter) {
      count++;
      yield row;
    }
    this._emit(operation, sql, performance.now() - start, count);
  }

  private _emit(
    operation: string,
    sql: string,
    durationMs: number,
    rowCount: number
  ): void {
    if (!this.metricsHook) return;
    this.metricsHook({
      table: this.tableName,
      operation,
      sql,
      durationMs,
      rowCount,
    });
  }
}
