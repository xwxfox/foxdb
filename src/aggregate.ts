/**
 * foxdb/src/aggregate.ts
 * Builds parameterized SQL for aggregate queries.
 */

import type { TObject, TSchema } from "typebox";
import type { AggregateOptions } from "./types.ts";
import { buildWhere } from "./query-builder.ts";

export function buildAggregateSql<T extends TSchema & { properties: Record<string, TSchema> }>(
  tableName: string,
  opts: AggregateOptions<T>,
  softDeleteColumn?: string
): { sql: string; params: unknown[] } {
  const { sql: whereSql, params: whereParams } = buildWhere(
    opts.where,
    opts.includeDeleted ? undefined : softDeleteColumn
  );
  const selectParts: string[] = [];

  if (opts.groupBy) {
    for (const col of opts.groupBy) selectParts.push(`"${col}"`);
  }

  for (const [alias, op] of Object.entries(opts.aggregations)) {
    if ("sum" in op && op.sum) selectParts.push(`SUM("${op.sum}") as "${alias}"`);
    else if ("count" in op && op.count) {
      selectParts.push(`COUNT(${op.count === "*" ? "*" : `"${op.count}"`}) as "${alias}"`);
    }
    else if ("avg" in op && op.avg) selectParts.push(`AVG("${op.avg}") as "${alias}"`);
    else if ("min" in op && op.min) selectParts.push(`MIN("${op.min}") as "${alias}"`);
    else if ("max" in op && op.max) selectParts.push(`MAX("${op.max}") as "${alias}"`);
  }

  const groupBySql = opts.groupBy ? `GROUP BY ${opts.groupBy.map(c => `"${c}"`).join(", ")}` : "";
  const sql = `SELECT ${selectParts.join(", ")} FROM "${tableName}" ${whereSql} ${groupBySql}`.trim();
  return { sql, params: whereParams };
}
