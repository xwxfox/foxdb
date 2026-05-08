/**
 * foxdb/src/window.ts
 * Builds parameterized SQL for window function queries.
 */

import type { TSchema } from "typebox";
import type { WindowQueryOptions, WindowFunction } from "./types.ts";
import type { TableMeta } from "./schema.ts";
import { buildWhere, resolveOrderByColumn } from "./query-builder.ts";

function buildWindowSqlExpression<T extends TSchema & { properties: Record<string, TSchema> }>(
  alias: string,
  fn: WindowFunction<T>,
  overClause: string,
  meta?: TableMeta
): string {
  if ("rowNumber" in fn) return `ROW_NUMBER() OVER (${overClause}) as "${alias}"`;
  if ("rank" in fn) return `RANK() OVER (${overClause}) as "${alias}"`;
  if ("denseRank" in fn) return `DENSE_RANK() OVER (${overClause}) as "${alias}"`;
  if ("lead" in fn) {
    const col = resolveOrderByColumn(fn.lead, meta);
    const offset = fn.offset ?? 1;
    return `LEAD(${col}, ${offset}) OVER (${overClause}) as "${alias}"`;
  }
  if ("lag" in fn) {
    const col = resolveOrderByColumn(fn.lag, meta);
    const offset = fn.offset ?? 1;
    return `LAG(${col}, ${offset}) OVER (${overClause}) as "${alias}"`;
  }
  return `"${alias}"`;
}

export function buildWindowSql<T extends TSchema & { properties: Record<string, TSchema> }>(
  tableName: string,
  opts: WindowQueryOptions<T>,
  softDeleteColumn?: string,
  meta?: TableMeta
): { sql: string; params: unknown[] } {
  const { sql: whereSql, params: whereParams } = buildWhere(
    opts.where,
    softDeleteColumn,
    meta
  );

  const partitionSql = opts.partitionBy && opts.partitionBy.length > 0
    ? `PARTITION BY ${opts.partitionBy.map((c) => resolveOrderByColumn(c, meta)).join(", ")}`
    : "";

  const orderClauses = opts.orderBy
    ? (Array.isArray(opts.orderBy) ? opts.orderBy : [opts.orderBy]).map((o) => {
        const col = resolveOrderByColumn(o.column, meta);
        return `${col} ${o.direction ?? "ASC"}`;
      })
    : [];
  const orderSql = orderClauses.length > 0 ? `ORDER BY ${orderClauses.join(", ")}` : "";

  const overParts = [partitionSql, orderSql].filter(Boolean).join(" ");
  const overClause = overParts ? overParts : "ORDER BY (SELECT NULL)";

  const selectParts: string[] = [];
  for (const [alias, fn] of Object.entries(opts.select)) {
    selectParts.push(buildWindowSqlExpression(alias, fn, overClause, meta));
  }

  const limitSql = opts.limit !== undefined ? `LIMIT ${opts.limit}` : "";

  const clauses = [
    `SELECT ${selectParts.join(", ")} FROM "${tableName}"`,
    whereSql,
    limitSql,
  ].filter(Boolean).join(" ");

  return { sql: clauses, params: whereParams };
}
