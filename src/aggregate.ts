/**
 * foxdb/src/aggregate.ts
 * Builds parameterized SQL for aggregate queries.
 */

import type { TObject, TSchema } from "typebox";
import type { AggregateOptions } from "./types.ts";
import type { TableMeta } from "./schema.ts";
import type { SQLQueryBindings } from "./database.ts";
import { buildWhere, buildFilter, type FilterShape } from "./query-builder.ts";

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

function resolveSubTableMeta(meta: TableMeta, subTable: string): { tableName: string; columnByPath: Map<string, import("./schema.ts").ColumnMeta> } | undefined {
  const st = meta.subTables.find((s) => s.fieldName === subTable);
  if (!st) return undefined;
  return { tableName: st.tableName, columnByPath: st.columnByPath };
}

export function buildAggregateSql<T extends TSchema & { properties: Record<string, TSchema> }>(
  tableName: string,
  opts: AggregateOptions<T>,
  softDeleteColumn?: string,
  meta?: TableMeta
): { sql: string; params: SQLQueryBindings[] } {
  const subMeta = opts.subTable && meta ? resolveSubTableMeta(meta, opts.subTable) : undefined;
  const effectiveTableName = subMeta?.tableName ?? tableName;
  const effectiveMeta = subMeta ? { ...meta!, columnByPath: subMeta.columnByPath } : meta;

  const { sql: whereSql, params: whereParams } = buildWhere(
    opts.where,
    opts.subTable ? undefined : (opts.includeDeleted ? undefined : softDeleteColumn),
    effectiveMeta
  );
  const selectParts: string[] = [];

  if (opts.groupBy) {
    for (const col of opts.groupBy) {
      const resolved = resolveAggColumn(col, effectiveMeta);
      selectParts.push(`${resolved} as "${col.replace(/"/g, '""')}"`);
    }
  }

  for (const [alias, op] of Object.entries(opts.aggregations)) {
    if ("sum" in op && op.sum) selectParts.push(`SUM(${resolveAggColumn(op.sum, effectiveMeta)}) as "${alias}"`);
    else if ("count" in op && op.count) {
      selectParts.push(`COUNT(${op.count === "*" ? "*" : resolveAggColumn(op.count, effectiveMeta)}) as "${alias}"`);
    }
    else if ("avg" in op && op.avg) selectParts.push(`AVG(${resolveAggColumn(op.avg, effectiveMeta)}) as "${alias}"`);
    else if ("min" in op && op.min) selectParts.push(`MIN(${resolveAggColumn(op.min, effectiveMeta)}) as "${alias}"`);
    else if ("max" in op && op.max) selectParts.push(`MAX(${resolveAggColumn(op.max, effectiveMeta)}) as "${alias}"`);
  }

  const groupBySql = opts.groupBy ? `GROUP BY ${opts.groupBy.map(c => resolveAggColumn(c, effectiveMeta)).join(", ")}` : "";

  const havingParts: string[] = [];
  const havingParams: SQLQueryBindings[] = [];
  if (opts.having) {
    for (const [alias, filter] of Object.entries(opts.having)) {
      if (filter && typeof filter === "object" && !Array.isArray(filter)) {
        const entry = buildFilter(alias, filter as FilterShape, effectiveMeta);
        havingParts.push(entry.sql);
        havingParams.push(...entry.params);
      }
    }
  }
  const havingSql = havingParts.length > 0 ? `HAVING ${havingParts.join(" AND ")}` : "";

  const sql = `SELECT ${selectParts.join(", ")} FROM "${effectiveTableName}" ${whereSql} ${groupBySql} ${havingSql}`.trim();
  return { sql, params: [...whereParams, ...havingParams] };
}
