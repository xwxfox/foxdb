import { feature } from "bun:bundle";
import type { BunDatabase, SQLQueryBindings } from "./database.ts";
import type { QueryMetrics } from "./types.ts";
import { sqlDebug, traceBegin, traceEnd } from "./tracing.ts";

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

  // 3. Large IN clause (your case!)
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
    const bindings = params ?? [];
    const plan = this._debugQueryPlan(sql, bindings);
    traceBegin(`sql.${operation}`, { sql: sql.slice(0, 160), paramsCount: bindings.length, plan });
    const start = performance.now();
    const result = this._getStmt(sql).run(...bindings);
    const durMs = performance.now() - start;
    this._emit(operation, sql, durMs, result.changes);
    traceEnd({ durMs, sql: sql.slice(0, 160), rowCount: result.changes, plan });
    return result;
  }

  all<T>(sql: string, params?: SQLQueryBindings[], operation = "read"): T[] {
    const bindings = params ?? [];
    const plan = this._debugQueryPlan(sql, bindings);
    traceBegin(`sql.${operation}`, { sql: sql.slice(0, 160), paramsCount: bindings.length, plan });
    const start = performance.now();
    const rows = this._getStmt(sql).all(...bindings) as T[];
    const durMs = performance.now() - start;
    this._emit(operation, sql, durMs, rows.length);
    traceEnd({ durMs, sql: sql.slice(0, 160), rowCount: rows.length, plan });
    return rows;
  }

  get<T>(sql: string, params?: SQLQueryBindings[], operation = "read"): T | null {
    const bindings = params ?? [];
    const plan = this._debugQueryPlan(sql, bindings);
    traceBegin(`sql.${operation}`, { sql: sql.slice(0, 160), paramsCount: bindings.length, plan });
    const start = performance.now();
    const row = this._getStmt(sql).get(...bindings) as T | undefined;
    const durMs = performance.now() - start;
    const rowCount = row == null ? 0 : 1;
    this._emit(operation, sql, durMs, rowCount);
    traceEnd({ durMs, sql: sql.slice(0, 160), rowCount, plan });
    return row ?? null;
  }

  *iterate<T>(
    sql: string,
    params?: SQLQueryBindings[],
    operation = "read"
  ): Generator<T> {
    const bindings = params ?? [];
    const plan = this._debugQueryPlan(sql, bindings);
    traceBegin(`sql.${operation}`, { sql: sql.slice(0, 160), paramsCount: bindings.length, plan });
    const start = performance.now();
    const iter = this._getStmt(sql)
      .iterate(...bindings) as IterableIterator<T>;
    let count = 0;
    for (const row of iter) {
      count++;
      yield row;
    }
    const durMs = performance.now() - start;
    traceEnd({ durMs, rowCount: count, sql: sql.slice(0, 160), plan });
    this._emit(operation, sql, durMs, count);
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
