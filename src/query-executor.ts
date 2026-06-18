import { feature } from "bun:bundle";
import type { BunDatabase, SQLQueryBindings } from "./database.ts";
import type { QueryMetrics } from "./types.ts";
import { sqlDebug, traceBegin, traceEnd, sqlFileWrite } from "./tracing.ts";

export interface QueryExecutorOptions {
  db: BunDatabase;
  tableName: string;
  metricsHook?: (meta: QueryMetrics) => void;
}
interface StmtStats {
  sql: string;
  exec_count: number;
  cost: {
    fullscan_steps: number;
    sort_ops: number;
    autoindex: number;
  };
}
function parseStmtStats(raw: any): StmtStats | null {
  if (!raw?.stats) return null;

  // Dynamically targets text between "sql":" and ","exec_count"
  const fixedJsonString = raw.stats.replace(
    /("sql"\s*:\s*")([\s\S]*?)("\s*,\s*"exec_count")/g,
    (match: string, prefix: string, sqlBody: string, suffix: string) => {
      // Swaps all unescaped double quotes inside the SQL body to single quotes
      const cleanedSql = sqlBody.replace(/"/g, "'");
      return `${prefix}${cleanedSql}${suffix}`;
    }
  );

  try {
    return JSON.parse(fixedJsonString) as StmtStats;
  } catch (error) {
    console.error("Failed to parse SQL stats JSON:", error);
    return null;
  }
}
function analyzeCost(planRows: any[], stmt: StmtStats, durationMs: number) {
  let score = 0;
  const hints: string[] = [];

  const planText = planRows.map(r => r.detail).join(" ");

  // 1. Full scan detection
  if (planText.includes("SCAN") && !planText.includes("USING INDEX")) {
    score += 50;
    hints.push("Full table scan detected");
  }

  // 2. Temp B-tree sort
  if (planText.includes("TEMP B-TREE")) {
    score += 25;
    hints.push("Sorting requires temporary B-tree (ORDER BY cost)");
  }

  // 3. Large IN clause
  if (planText.includes("IN (")) {
    score += 20;
    hints.push("Large IN clause may cause execution fanout");
  }

  // 4. Real execution cost signal
  if (stmt?.cost?.fullscan_steps > 100000) {
    score += 30;
    hints.push("High fullscan_steps detected (execution pressure)");
  }

  return {
    score: Math.min(100, score),
    hints,
  };
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

  private _debugQueryPlan(sql: string, params: SQLQueryBindings[]) {
    if (!feature("DEBUG_SQL_BUILDING")) return undefined;

    const normalized = sql.trim().replace(/;$/, "");
    const first = normalized.split(/\s+/, 1)[0]?.toUpperCase();
    if (!["SELECT", "WITH"].includes(first ?? "")) {
      sqlDebug(`plan skipped for ${first ?? "unknown"}: ${this.tableName}`, { sql: normalized });
      return undefined;
    }

    const planSql = `EXPLAIN QUERY PLAN ${normalized}`;
    const planStart = performance.now();
    try {
      const rows = this.db.prepare(planSql).all(...params) as {
        detail: string
      }[]
      const planMs = performance.now() - planStart;
      // sqlDebug(`plan for ${this.tableName}`, { operation: "read", sql: normalized, params, planSql, planMs, rows });
      const stmtStats = this.db.getStmtStats(sql);
      const stmt = parseStmtStats(stmtStats)!;
      console.log(stmt)
      const costAnalysis = analyzeCost(
        rows,
        stmt,
        planMs
      );

      const planNotes = rows.map((r) => r["detail"] ?? undefined)
      sqlDebug("sql analyze", {
        sql,
        params,
        plam: { operation: "read", planMs, planNotes },
        stmt: {
          cost: stmt.cost,
          exec_count: stmt.exec_count
        },
        costAnalysis,
      });
      return { planSql, planMs, rows };
    } catch (error) {
      const planMs = performance.now() - planStart;
      sqlDebug(`plan failed for ${this.tableName}`, { sql: normalized, params, planSql, planMs, error: error instanceof Error ? error.message : String(error) });
      return { planSql, planMs, error: error instanceof Error ? error.message : String(error) };
    }
  }

  exec(
    sql: string,
    params?: SQLQueryBindings[],
    operation = "raw"
  ): { changes: number; lastInsertRowid: number | bigint } {
    if (feature("DEBUG_SQL_FILE")) sqlFileWrite(sql, params ?? []);
    if (feature("DEBUG_TRACING")) {
      const b = params ?? [];
      const p = this._debugQueryPlan(sql, b);
      traceBegin(`sql.${operation}`, { sql: sql.slice(0, 160), paramsCount: b.length, plan: p });
      const s = performance.now();
      const r = this._getStmt(sql).run(...b);
      const d = performance.now() - s;
      this._emit(operation, sql, d, r.changes);
      traceEnd({ durMs: d, sql: sql.slice(0, 160), rowCount: r.changes });
      return r;
    }
    const start = performance.now();
    const result = this._getStmt(sql).run(...(params ?? []));
    this._emit(operation, sql, performance.now() - start, result.changes);
    return result;
  }

  all<T>(sql: string, params?: SQLQueryBindings[], operation = "read"): T[] {
    if (feature("DEBUG_SQL_FILE")) sqlFileWrite(sql, params ?? []);
    if (feature("DEBUG_TRACING")) {
      const b = params ?? [];
      const p = this._debugQueryPlan(sql, b);
      traceBegin(`sql.${operation}`, { sql: sql.slice(0, 160), paramsCount: b.length, plan: p });
      const s = performance.now();
      const rows = this._getStmt(sql).all(...b) as T[];
      const d = performance.now() - s;
      this._emit(operation, sql, d, rows.length);
      traceEnd({ durMs: d, sql: sql.slice(0, 160), rowCount: rows.length });
      return rows;
    }
    const start = performance.now();
    const rows = this._getStmt(sql).all(...(params ?? [])) as T[];
    this._emit(operation, sql, performance.now() - start, rows.length);
    return rows;
  }

  get<T>(sql: string, params?: SQLQueryBindings[], operation = "read"): T | null {
    if (feature("DEBUG_SQL_FILE")) sqlFileWrite(sql, params ?? []);
    if (feature("DEBUG_TRACING")) {
      const b = params ?? [];
      const p = this._debugQueryPlan(sql, b);
      traceBegin(`sql.${operation}`, { sql: sql.slice(0, 160), paramsCount: b.length, plan: p });
      const s = performance.now();
      const row = this._getStmt(sql).get(...b) as T | undefined;
      const d = performance.now() - s;
      this._emit(operation, sql, d, row ? 1 : 0);
      traceEnd({ durMs: d, sql: sql.slice(0, 160), rowCount: row ? 1 : 0 });
      return row ?? null;
    }
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
    if (feature("DEBUG_SQL_FILE")) sqlFileWrite(sql, params ?? []);
    if (feature("DEBUG_TRACING")) {
      const b = params ?? [];
      const p = this._debugQueryPlan(sql, b);
      traceBegin(`sql.${operation}`, { sql: sql.slice(0, 160), paramsCount: b.length, plan: p });
      const s = performance.now();
      const iter = this._getStmt(sql).iterate(...b) as IterableIterator<T>;
      let c = 0;
      for (const row of iter) { c++; yield row; }
      const d = performance.now() - s;
      traceEnd({ durMs: d, rowCount: c, sql: sql.slice(0, 160) });
      return this._emit(operation, sql, d, c);
    }
    const start = performance.now();
    const iter = this._getStmt(sql).iterate(...(params ?? [])) as IterableIterator<T>;
    let count = 0;
    for (const row of iter) { count++; yield row; }
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
