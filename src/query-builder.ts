/**
 * foxdb/src/query-builder.ts
 * Builds parameterized SQL from typed WhereClause / OrderBy / pagination.
 * Never does string interpolation of user values - always uses ? placeholders.
 */

import type { TObject } from "typebox";
import type {
  WhereClause,
  OrderByClause,
  FindOptions,
} from "./types.ts";
import { raise } from "./errors.ts";

// ─── WHERE builder ────────────────────────────────────────────────────────────

type FilterEntry = { sql: string; params: unknown[] };

/** Runtime shape of any filter - independent of the column's value type */
type FilterShape =
  | { eq: unknown }
  | { ne: unknown }
  | { gt: unknown }
  | { gte: unknown }
  | { lt: unknown }
  | { lte: unknown }
  | { like: string }
  | { between: [unknown, unknown] }
  | { in: readonly unknown[] }
  | { notIn: readonly unknown[] }
  | { isNull: true }
  | { isNotNull: true };

function isFilterShape(value: unknown): value is FilterShape {
  return typeof value === "object" && value !== null;
}

function resolveJsonColumn(column: string): { sql: string } | null {
  const parts = column.split(".");
  if (parts.length < 2) return null;
  const jsonColumn = parts[0];
  const path = parts.slice(1).join(".");
  return { sql: `JSON_EXTRACT("${jsonColumn}", '$.${path}')` };
}

function buildFilter(column: string, filter: FilterShape): FilterEntry {
  const jsonCol = resolveJsonColumn(column);
  const colRef = jsonCol ? jsonCol.sql : `"${column}"`;

  if ("eq" in filter) return { sql: `${colRef} = ?`, params: [filter.eq] };
  if ("ne" in filter) return { sql: `${colRef} != ?`, params: [filter.ne] };
  if ("gt" in filter) return { sql: `${colRef} > ?`, params: [filter.gt] };
  if ("gte" in filter) return { sql: `${colRef} >= ?`, params: [filter.gte] };
  if ("lt" in filter) return { sql: `${colRef} < ?`, params: [filter.lt] };
  if ("lte" in filter) return { sql: `${colRef} <= ?`, params: [filter.lte] };
  if ("like" in filter) return { sql: `${colRef} LIKE ?`, params: [filter.like] };
  if ("between" in filter) {
    const [lo, hi] = filter.between;
    return { sql: `${colRef} BETWEEN ? AND ?`, params: [lo, hi] };
  }
  if ("in" in filter) {
    const vals = filter.in;
    const placeholders = vals.map(() => "?").join(", ");
    return { sql: `${colRef} IN (${placeholders})`, params: [...vals] };
  }
  if ("notIn" in filter) {
    const vals = filter.notIn;
    const placeholders = vals.map(() => "?").join(", ");
    return { sql: `${colRef} NOT IN (${placeholders})`, params: [...vals] };
  }
  if ("isNull" in filter) return { sql: `${colRef} IS NULL`, params: [] };
  if ("isNotNull" in filter) return { sql: `${colRef} IS NOT NULL`, params: [] };
  raise("UNKNOWN_FILTER", `foxdb: unknown filter operator for column "${column}"`, { column });
}

export interface WhereResult {
  sql: string;      // "WHERE ..." or ""
  params: unknown[];
}

/**
 * Logical operators for WHERE clauses.
 *
 * **Known limitation:** `AND`, `OR`, and `NOT` are reserved keys and cannot
 * be used as column names in schemas.
 */
export type WhereLogic<T extends TObject = TObject> = {
  AND?: WhereClause<T>[];
  OR?: WhereClause<T>[];
  NOT?: WhereClause<T>;
};

function isWhereLogic(value: unknown): value is WhereLogic {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if ("AND" in v && Array.isArray(v.AND)) return true;
  if ("OR" in v && Array.isArray(v.OR)) return true;
  if ("NOT" in v && typeof v.NOT === "object" && v.NOT !== null) return true;
  return false;
}

function isTriviallyTrue(where: unknown): boolean {
  if (!where || typeof where !== "object" || Object.keys(where).length === 0) {
    return true;
  }
  const w = where as Record<string, unknown>;
  const keys = Object.keys(w);
  // { AND: [] } is trivially true
  if (keys.length === 1 && keys[0] === "AND" && Array.isArray(w.AND) && w.AND.length === 0) {
    return true;
  }
  // { OR: [...] } is trivially true if any child is trivially true
  if (keys.length === 1 && keys[0] === "OR" && Array.isArray(w.OR) && w.OR.some(isTriviallyTrue)) {
    return true;
  }
  // { NOT: x } is trivially true if x is trivially false
  if (keys.length === 1 && keys[0] === "NOT" && isTriviallyFalse(w.NOT)) {
    return true;
  }
  return false;
}

function isTriviallyFalse(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const w = where as Record<string, unknown>;
  const keys = Object.keys(w);
  // { OR: [] } is trivially false
  if (keys.length === 1 && keys[0] === "OR" && Array.isArray(w.OR) && w.OR.length === 0) {
    return true;
  }
  // { AND: [...] } is trivially false if any child is trivially false
  if (keys.length === 1 && keys[0] === "AND" && Array.isArray(w.AND) && w.AND.some(isTriviallyFalse)) {
    return true;
  }
  // { NOT: x } is trivially false if x is trivially true
  if (keys.length === 1 && keys[0] === "NOT" && isTriviallyTrue(w.NOT)) {
    return true;
  }
  return false;
}

function buildWhereRecursive<T extends TObject>(
  where: WhereClause<T> | undefined,
  softDeleteColumn?: string
): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  if (softDeleteColumn) {
    parts.push(`"${softDeleteColumn}" IS NULL`);
  }

  if (!where || Object.keys(where).length === 0) {
    if (parts.length === 0) return { sql: "", params: [] };
    return { sql: `WHERE ${parts.join(" AND ")}`, params };
  }

  // Handle logical operators first
  if (isWhereLogic(where)) {
    const logic = where as WhereLogic;

    if (logic.AND) {
      for (const clause of logic.AND) {
        if (isTriviallyTrue(clause)) continue;
        if (isTriviallyFalse(clause)) {
          parts.push("1=0");
          if (parts.length === 1) return { sql: "WHERE 1=0", params: [] };
          return { sql: `WHERE ${parts.join(" AND ")}`, params };
        }
        const child = buildWhereRecursive(clause, undefined);
        if (child.sql) {
          parts.push(`(${child.sql.replace(/^WHERE\s+/, "")})`);
          params.push(...child.params);
        }
      }
    }

    if (logic.OR) {
      const orParts: string[] = [];
      const orParams: unknown[] = [];
      for (const clause of logic.OR) {
        if (isTriviallyTrue(clause)) {
          orParts.length = 0;
          break;
        }
        if (isTriviallyFalse(clause)) continue;
        const child = buildWhereRecursive(clause, undefined);
        if (child.sql) {
          orParts.push(child.sql.replace(/^WHERE\s+/, ""));
          orParams.push(...child.params);
        }
      }
      if (orParts.length > 0) {
        parts.push(`(${orParts.join(" OR ")})`);
        params.push(...orParams);
      } else if (!logic.OR.some(isTriviallyTrue)) {
        parts.push("1=0");
      }
    }

    if (logic.NOT) {
      if (isTriviallyTrue(logic.NOT)) {
        parts.push("1=0");
      } else if (!isTriviallyFalse(logic.NOT)) {
        const child = buildWhereRecursive(logic.NOT, undefined);
        if (child.sql) {
          parts.push(`NOT (${child.sql.replace(/^WHERE\s+/, "")})`);
          params.push(...child.params);
        }
      }
    }
  }

  // Handle column filters
  for (const [col, filter] of Object.entries(where)) {
    if (col === "AND" || col === "OR" || col === "NOT") continue;
    if (!isFilterShape(filter)) continue;
    const entry = buildFilter(col, filter);
    parts.push(entry.sql);
    params.push(...entry.params);
  }

  if (parts.length === 0) return { sql: "", params: [] };
  return { sql: `WHERE ${parts.join(" AND ")}`, params };
}

export function buildWhere<T extends TObject>(
  where: WhereClause<T> | undefined,
  softDeleteColumn?: string
): WhereResult {
  return buildWhereRecursive(where, softDeleteColumn);
}

// ─── ORDER BY builder ─────────────────────────────────────────────────────────

export function buildOrderBy<T extends TObject>(
  orderBy: FindOptions<T>["orderBy"]
): string {
  if (!orderBy) return "";
  const clauses: OrderByClause<T>[] = globalThis.Array.isArray(orderBy) ? orderBy : [orderBy];
  if (clauses.length === 0) return "";
  const parts = clauses.map(
    (o) => `"${o.column}" ${o.direction ?? "ASC"}`
  );
  return `ORDER BY ${parts.join(", ")}`;
}

// ─── LIMIT / OFFSET ───────────────────────────────────────────────────────────

export function buildLimitOffset(
  limit?: number,
  offset?: number
): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (limit !== undefined) {
    parts.push("LIMIT ?");
    params.push(limit);
  }
  if (offset !== undefined) {
    parts.push("OFFSET ?");
    params.push(offset);
  }
  return { sql: parts.join(" "), params };
}

// ─── Full SELECT builder ──────────────────────────────────────────────────────

export interface SelectResult {
  sql: string;
  params: unknown[];
  countSql: string;
  countParams: unknown[];
}

export function buildSelectSql<T extends TObject>(
  tableName: string,
  opts: FindOptions<T>,
  softDeleteColumn?: string
): SelectResult {
  const { sql: whereSql, params: whereParams } = buildWhere(
    opts.where,
    opts.includeDeleted ? undefined : softDeleteColumn
  );
  const orderSql = buildOrderBy(opts.orderBy);
  const { sql: limitSql, params: limitParams } = buildLimitOffset(
    opts.limit,
    opts.offset
  );

  const selectCols = opts.select
    ? opts.select.map((c) => `"${c}"`).join(", ")
    : "*";

  const clauses = [
    `SELECT ${selectCols} FROM "${tableName}"`,
    whereSql,
    orderSql,
    limitSql,
  ]
    .filter(Boolean)
    .join(" ");

  const countClauses = [
    `SELECT COUNT(*) as "_count" FROM "${tableName}"`,
    whereSql,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    sql: clauses,
    params: [...whereParams, ...limitParams],
    countSql: countClauses,
    countParams: whereParams,
  };
}

export function buildSelect<T extends TObject>(
  tableName: string,
  opts: FindOptions<T>,
  softDeleteColumn?: string
): SelectResult {
  return buildSelectSql(tableName, opts, softDeleteColumn);
}

// ─── INSERT builder ───────────────────────────────────────────────────────────

export function buildInsert(
  tableName: string,
  row: Record<string, unknown>
): { sql: string; params: unknown[] } {
  const keys = Object.keys(row);
  const cols = keys.map((k) => `"${k}"`).join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  return {
    sql: `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders})`,
    params: keys.map((k) => row[k]),
  };
}

export function buildInsertMany(
  tableName: string,
  rows: Record<string, unknown>[],
  maxParams = 999
): Array<{ sql: string; params: unknown[] }> {
  if (rows.length === 0) return [];
  const first = rows[0]!;
  const keys = Object.keys(first);
  const colCount = keys.length;
  const maxRowsPerStmt = Math.floor(maxParams / colCount);
  if (maxRowsPerStmt <= 0) {
    raise("TOO_MANY_COLUMNS", `foxdb: table "${tableName}" has too many columns for multi-value insert`);
  }
  const batches: Array<{ sql: string; params: unknown[] }> = [];
  for (let i = 0; i < rows.length; i += maxRowsPerStmt) {
    const batch = rows.slice(i, i + maxRowsPerStmt);
    const cols = keys.map((k) => `"${k}"`).join(", ");
    const valueGroups = batch.map(() => {
      const ph = keys.map(() => "?").join(", ");
      return `(${ph})`;
    }).join(", ");
    const params = batch.flatMap((row) => keys.map((k) => row[k]));
    batches.push({ sql: `INSERT INTO "${tableName}" (${cols}) VALUES ${valueGroups}`, params });
  }
  return batches;
}

// ─── UPSERT (INSERT OR REPLACE / ON CONFLICT DO UPDATE) ──────────────────────

export function buildUpsert(
  tableName: string,
  row: Record<string, unknown>,
  conflictCols: string[],
  updateCols: string[]
): { sql: string; params: unknown[] } {
  const keys = Object.keys(row);
  const cols = keys.map((k) => `"${k}"`).join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  const conflict = conflictCols.map((c) => `"${c}"`).join(", ");
  const updates = updateCols
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(", ");

  return {
    sql: `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`,
    params: keys.map((k) => row[k]),
  };
}

// ─── UPDATE builder ───────────────────────────────────────────────────────────

export function buildUpdate<T extends TObject>(
  tableName: string,
  pk: string,
  pkValue: unknown,
  patch: Record<string, unknown>
): { sql: string; params: unknown[] } {
  const entries = Object.entries(patch).filter(([k]) => k !== pk);
  if (entries.length === 0) {
    raise("NO_COLUMNS_TO_UPDATE", "foxdb: no columns to update", { table: tableName });
  }
  const sets = entries.map(([k]) => `"${k}" = ?`).join(", ");
  return {
    sql: `UPDATE "${tableName}" SET ${sets} WHERE "${pk}" = ?`,
    params: [...entries.map(([, v]) => v), pkValue],
  };
}

// ─── DELETE builder ───────────────────────────────────────────────────────────

export function buildDelete<T extends TObject>(
  tableName: string,
  where: WhereClause<T>
): { sql: string; params: unknown[] } {
  const { sql: whereSql, params } = buildWhere(where);
  return {
    sql: `DELETE FROM "${tableName}" ${whereSql}`.trim(),
    params,
  };
}
