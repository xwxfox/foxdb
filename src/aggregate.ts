/**
 * foxdb/src/aggregate.ts
 * Builds parameterized SQL for aggregate queries.
 */

import type { TObject, TSchema } from "typebox";
import type { AggregateOptions } from "./types.ts";
import type { TableMeta } from "./schema.ts";
import { buildWhere, buildFilter } from "./query-builder.ts";

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function resolveAggColumn(column: string, meta?: TableMeta): string {
  if (!meta) return `"${column}"`;
  const flatCol = meta.columnByPath.get(column);
  if (flatCol) return `"${flatCol.name}"`;

  const parts = column.split(".");
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefixPath = parts.slice(0, i).join(".");
    const remainingPath = parts.slice(i).join(".");
    const prefixCol = meta.columnByPath.get(prefixPath);
    if (prefixCol && prefixCol.sqlType === "TEXT") {
      const safeColumn = prefixCol.name.replace(/"/g, '""');
      return `JSON_EXTRACT("${safeColumn}", '$.${escapeSqlString(remainingPath)}')`;
    }
  }

  return `"${column}"`;
}

export function buildAggregateSql<T extends TSchema & { properties: Record<string, TSchema> }>(
  tableName: string,
  opts: AggregateOptions<T>,
  softDeleteColumn?: string,
  meta?: TableMeta
): { sql: string; params: unknown[] } {
  const { sql: whereSql, params: whereParams } = buildWhere(
    opts.where,
    opts.includeDeleted ? undefined : softDeleteColumn,
    meta
  );
  const selectParts: string[] = [];

  if (opts.groupBy) {
    for (const col of opts.groupBy) {
      const resolved = resolveAggColumn(col, meta);
      selectParts.push(`${resolved} as "${col.replace(/"/g, '""')}"`);
    }
  }

  for (const [alias, op] of Object.entries(opts.aggregations)) {
    if ("sum" in op && op.sum) selectParts.push(`SUM(${resolveAggColumn(op.sum, meta)}) as "${alias}"`);
    else if ("count" in op && op.count) {
      selectParts.push(`COUNT(${op.count === "*" ? "*" : resolveAggColumn(op.count, meta)}) as "${alias}"`);
    }
    else if ("avg" in op && op.avg) selectParts.push(`AVG(${resolveAggColumn(op.avg, meta)}) as "${alias}"`);
    else if ("min" in op && op.min) selectParts.push(`MIN(${resolveAggColumn(op.min, meta)}) as "${alias}"`);
    else if ("max" in op && op.max) selectParts.push(`MAX(${resolveAggColumn(op.max, meta)}) as "${alias}"`);
  }

  const groupBySql = opts.groupBy ? `GROUP BY ${opts.groupBy.map(c => resolveAggColumn(c, meta)).join(", ")}` : "";

  const havingParts: string[] = [];
  const havingParams: unknown[] = [];
  if (opts.having) {
    for (const [alias, filter] of Object.entries(opts.having)) {
      if (filter && typeof filter === "object" && !Array.isArray(filter)) {
        const entry = buildFilter(alias, filter as any);
        havingParts.push(entry.sql);
        havingParams.push(...entry.params);
      }
    }
  }
  const havingSql = havingParts.length > 0 ? `HAVING ${havingParts.join(" AND ")}` : "";

  const sql = `SELECT ${selectParts.join(", ")} FROM "${tableName}" ${whereSql} ${groupBySql} ${havingSql}`.trim();
  return { sql, params: [...whereParams, ...havingParams] };
}
