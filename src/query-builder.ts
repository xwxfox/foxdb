/**
 * foxdb/src/query-builder.ts
 * Builds parameterized SQL from typed WhereClause / OrderBy / pagination.
 * Never does string interpolation of user values - always uses ? placeholders.
 */

import type { TObject, TSchema } from "typebox";
import type { SQLQueryBindings } from "./database.ts";
import type {
  WhereClause,
  OrderByClause,
  FindOptions,
} from "./types.ts";
import type { TableMeta } from "./schema.ts";
import { raise } from "./errors.ts";
import { feature } from "bun:bundle";
import { sqlDebug, traceBegin, traceEnd } from "./tracing.ts";

// --- WHERE builder ------------------------------------------------------------

type FilterEntry = { sql: string; params: SQLQueryBindings[] };

/**
 * Runtime shape of any filter - independent of the column's value type
 */
export type FilterShape =
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
  | { isNotNull: true }
  | { arraySome: unknown }
  | { arrayNot: unknown }
  | { isEmpty: boolean }
  | { fastArraySome: unknown }
  | { fastArrayNot: unknown }
  | { fastArrayIsEmpty: boolean };

function isFilterShape(value: unknown): value is FilterShape {
  return typeof value === "object" && value !== null;
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Resolves a dotted column path that references a sub-table field.
 * e.g. "SalesLineItems.ItemNumber" → subquery on sales__SalesLineItems
 */
function resolveSubTableColumn(
  column: string,
  meta?: TableMeta
): { subTableName: string; subColumn: string; ownerPk: string } | null {
  if (!meta) return null;
  const parts = column.split(".");
  if (parts.length < 2) return null;

  const firstSegment = parts[0]!;
  const sub = meta.subTables.find((s) => s.fieldName === firstSegment);
  if (!sub) return null;

  const remainingPath = parts.slice(1).join(".");
  const subCol = sub.columnByPath.get(remainingPath);
  if (!subCol && parts.length === 2) {
    // Direct column access on sub-table, e.g. "SalesLineItems.ItemNumber"
    // Check if the column exists by name
    const directCol = sub.columnByName.get(remainingPath);
    if (directCol) {
      return { subTableName: sub.tableName, subColumn: directCol.name, ownerPk: meta.primaryKey! };
    }
    return null;
  }
  if (subCol) {
    return { subTableName: sub.tableName, subColumn: subCol.name, ownerPk: meta.primaryKey! };
  }
  return null;
}

/**
 * Resolves a dotted column path to a JSON_EXTRACT expression.
 *
 * **Known limitation:** column names containing dots are interpreted as JSON
 * paths, alongside the `AND`/`OR`/`NOT` reservation in `WhereLogic`.
 */
function resolveJsonColumn(column: string, meta?: TableMeta): { sql: string } | null {
  const parts = column.split(".");
  if (parts.length < 2) return null;

  if (meta) {
    const flatCol = meta.columnByPath.get(column);
    if (flatCol) {
      return { sql: `"${flatCol.name}"` };
    }

    for (let i = parts.length - 1; i >= 1; i--) {
      const prefixPath = parts.slice(0, i).join(".");
      const remainingPath = parts.slice(i).join(".");
      const prefixCol = meta.columnByPath.get(prefixPath);
      if (prefixCol && prefixCol.sqlType === "TEXT") {
        const safeColumn = prefixCol.name.replace(/"/g, '""');
        return { sql: `JSON_EXTRACT("${safeColumn}", '$.${escapeSqlString(remainingPath)}')` };
      }
    }
  }

  const jsonColumn = parts[0]!;
  const path = parts.slice(1).join(".");
  const safeColumn = jsonColumn.replace(/"/g, '""');
  return { sql: `JSON_EXTRACT("${safeColumn}", '$.${escapeSqlString(path)}')` };
}

/** Safely convert a runtime value to SQLite-compatible binding. */
export function toBinding(v: unknown): SQLQueryBindings {
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return v;
  if (v instanceof Uint8Array) return v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** SQLite stores nested objects as JSON TEXT; mirror that when binding params. */
function paramValue(v: unknown): SQLQueryBindings {
  return toBinding(v);
}

export function buildFilter(column: string, filter: FilterShape, meta?: TableMeta): FilterEntry {
  if (feature("DEBUG_TRACING")) traceBegin("qb.buildFilter");
  sqlDebug(`buildFilter input`, { column, filter, tableName: meta?.tableName });

  // Check if this is a sub-table column reference, e.g. "SalesLineItems.ItemNumber"
  const subRef = column.indexOf(".") !== -1 ? resolveSubTableColumn(column, meta) : null;
  if (subRef) {
    sqlDebug(`buildFilter sub-table resolution`, { column, subTable: subRef.subTableName, subColumn: subRef.subColumn, ownerPk: subRef.ownerPk, reason: "dotted path references sub-table field → subquery" });
    // Generate a subquery: pk IN (SELECT _owner_id FROM subTable WHERE subColumn OP value)
    const innerParts: string[] = [];
    const innerParams: SQLQueryBindings[] = [];
    const subColRef = `"${subRef.subColumn}"`;

    if ("eq" in filter) { innerParts.push(`${subColRef} = ?`); innerParams.push(paramValue(filter.eq)); }
    if ("ne" in filter) { innerParts.push(`${subColRef} != ?`); innerParams.push(paramValue(filter.ne)); }
    if ("gt" in filter) { innerParts.push(`${subColRef} > ?`); innerParams.push(paramValue(filter.gt)); }
    if ("gte" in filter) { innerParts.push(`${subColRef} >= ?`); innerParams.push(paramValue(filter.gte)); }
    if ("lt" in filter) { innerParts.push(`${subColRef} < ?`); innerParams.push(paramValue(filter.lt)); }
    if ("lte" in filter) { innerParts.push(`${subColRef} <= ?`); innerParams.push(paramValue(filter.lte)); }
    if ("like" in filter) { innerParts.push(`${subColRef} LIKE ?`); innerParams.push(paramValue(filter.like)); }
    if ("between" in filter) {
      const [lo, hi] = filter.between;
      innerParts.push(`${subColRef} BETWEEN ? AND ?`);
      innerParams.push(paramValue(lo), paramValue(hi));
    }
    if ("in" in filter) {
      const vals = filter.in;
      const ph = vals.map(() => "?").join(", ");
      innerParts.push(`${subColRef} IN (${ph})`);
      innerParams.push(...vals.map(paramValue));
    }
    if ("notIn" in filter) {
      const vals = filter.notIn;
      const ph = vals.map(() => "?").join(", ");
      innerParts.push(`${subColRef} NOT IN (${ph})`);
      innerParams.push(...vals.map(paramValue));
    }
    if ("isNull" in filter) { innerParts.push(`${subColRef} IS NULL`); }
    if ("isNotNull" in filter) { innerParts.push(`${subColRef} IS NOT NULL`); }

    if (innerParts.length > 0) {
      const innerWhere = innerParts.join(" AND ");
      const subquery = `EXISTS (SELECT 1 FROM "${subRef.subTableName}" WHERE "${subRef.subTableName}"."_owner_id" = "${meta!.tableName}"."${subRef.ownerPk}" AND ${innerWhere})`;
      const result: FilterEntry = { sql: subquery, params: innerParams };
      sqlDebug(`buildFilter sub-table result`, { column, result });
      if (feature("DEBUG_TRACING")) traceEnd();
      return result;
    }
    const emptyResult: FilterEntry = { sql: "1=0", params: [] };
    if (feature("DEBUG_TRACING")) traceEnd();
    return emptyResult;
  }

  const jsonCol = resolveJsonColumn(column, meta);
  const colRef = jsonCol ? jsonCol.sql : `"${column}"`;
  sqlDebug(`buildFilter column resolution`, { column, colRef, flattened: Boolean(jsonCol), reason: jsonCol ? "matched flattened column or JSON_EXTRACT path" : "plain column" });

  const parts: string[] = [];
  const params: SQLQueryBindings[] = [];

  if ("eq" in filter) { parts.push(`${colRef} = ?`); params.push(paramValue(filter.eq)); }
  if ("ne" in filter) { parts.push(`${colRef} != ?`); params.push(paramValue(filter.ne)); }
  if ("gt" in filter) { parts.push(`${colRef} > ?`); params.push(paramValue(filter.gt)); }
  if ("gte" in filter) { parts.push(`${colRef} >= ?`); params.push(paramValue(filter.gte)); }
  if ("lt" in filter) { parts.push(`${colRef} < ?`); params.push(paramValue(filter.lt)); }
  if ("lte" in filter) { parts.push(`${colRef} <= ?`); params.push(paramValue(filter.lte)); }
  if ("like" in filter) { parts.push(`${colRef} LIKE ?`); params.push(paramValue(filter.like)); }
  if ("between" in filter) {
    const [lo, hi] = filter.between;
    parts.push(`${colRef} BETWEEN ? AND ?`);
    params.push(paramValue(lo), paramValue(hi));
  }
  if ("in" in filter) {
    const vals = filter.in;
    const placeholders = vals.map(() => "?").join(", ");
    parts.push(`${colRef} IN (${placeholders})`);
    params.push(...vals.map(paramValue));
  }
  if ("notIn" in filter) {
    const vals = filter.notIn;
    const placeholders = vals.map(() => "?").join(", ");
    parts.push(`${colRef} NOT IN (${placeholders})`);
    params.push(...vals.map(paramValue));
  }
  if ("isNull" in filter) parts.push(`${colRef} IS NULL`);
  if ("isNotNull" in filter) parts.push(`${colRef} IS NOT NULL`);
  if ("arraySome" in filter) {
    const scalarSub = meta?.subTables.find(
      st => st.fieldName === column && st.isScalar
    );
    const usesSubTable = Boolean(scalarSub && meta?.primaryKey);
    if (usesSubTable) {
      parts.push(
        `"${meta!.primaryKey}" IN (SELECT "_owner_id" FROM "${scalarSub!.tableName}" WHERE "_value" = ?)`
      );
    } else {
      parts.push(`EXISTS (SELECT 1 FROM json_each(${colRef}) WHERE value = ?)`);
    }
    sqlDebug(`buildFilter arraySome choice`, { column, usesSubTable, subTable: scalarSub?.tableName, jsonColRef: colRef });
    params.push(paramValue(filter.arraySome));
  }
  if ("arrayNot" in filter) {
    const scalarSub = meta?.subTables.find(
      st => st.fieldName === column && st.isScalar
    );
    const usesSubTable = Boolean(scalarSub && meta?.primaryKey);
    if (usesSubTable) {
      parts.push(
        `"${meta!.primaryKey}" NOT IN (SELECT "_owner_id" FROM "${scalarSub!.tableName}" WHERE "_value" = ?)`
      );
    } else {
      parts.push(`NOT EXISTS (SELECT 1 FROM json_each(${colRef}) WHERE value = ?)`);
    }
    sqlDebug(`buildFilter arrayNot choice`, { column, usesSubTable, subTable: scalarSub?.tableName, jsonColRef: colRef });
    params.push(paramValue(filter.arrayNot));
  }
  if ("isEmpty" in filter) {
    const scalarSub = meta?.subTables.find(
      st => st.fieldName === column && st.isScalar
    );
    const usesSubTable = Boolean(scalarSub && meta?.primaryKey);
    if (usesSubTable) {
      if (filter.isEmpty) {
        parts.push(
          `"${meta!.primaryKey}" NOT IN (SELECT DISTINCT "_owner_id" FROM "${scalarSub!.tableName}")`
        );
      } else {
        parts.push(
          `"${meta!.primaryKey}" IN (SELECT DISTINCT "_owner_id" FROM "${scalarSub!.tableName}")`
        );
      }
    } else {
      if (filter.isEmpty) {
        parts.push(`(json_array_length(${colRef}) = 0 OR ${colRef} IS NULL)`);
      } else {
        parts.push(`json_array_length(${colRef}) > 0`);
      }
    }
    sqlDebug(`buildFilter isEmpty choice`, { column, filter: filter.isEmpty, usesSubTable, subTable: scalarSub?.tableName, jsonColRef: colRef });
  }
  if ("fastArrayIsEmpty" in filter) {
    if (filter.fastArrayIsEmpty) {
      parts.push(`(${colRef} = '[]' OR ${colRef} IS NULL)`);
    } else {
      parts.push(`(${colRef} != '[]' AND ${colRef} IS NOT NULL)`);
    }
  }
  if ("fastArraySome" in filter) {
    const jsonValue = JSON.stringify([filter.fastArraySome]);
    const inner = jsonValue.substring(1, jsonValue.length - 1);
    parts.push(`(',' || REPLACE(REPLACE(${colRef}, '[', ''), ']', '') || ',') LIKE ?`);
    params.push(`%,${inner},%`);
  }
  if ("fastArrayNot" in filter) {
    const jsonValue = JSON.stringify([filter.fastArrayNot]);
    const inner = jsonValue.substring(1, jsonValue.length - 1);
    parts.push(`(',' || REPLACE(REPLACE(${colRef}, '[', ''), ']', '') || ',') NOT LIKE ?`);
    params.push(`%,${inner},%`);
  }

  if (parts.length === 0) {
    raise("UNKNOWN_FILTER", `foxdb: unknown filter operator for column "${column}"`, { column });
  }

  const result = { sql: parts.join(" AND "), params };
  sqlDebug(`buildFilter output`, { column, result });
  if (feature("DEBUG_TRACING")) traceEnd();
  return result;
}

export interface WhereResult {
  sql: string;
  params: SQLQueryBindings[];
}

/**
 * Logical operators for WHERE clauses.
 *
 * **Known limitation:** `AND`, `OR`, and `NOT` are reserved keys and cannot
 * be used as column names in schemas.
 */
export type WhereLogic<T extends TSchema & { properties: Record<string, TSchema> } = TSchema & { properties: Record<string, TSchema> }> = {
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
  if (!where || typeof where !== "object" || Object.keys(where as Record<string, unknown>).length === 0) {
    return true;
  }
  const w = where as Record<string, unknown>;
  const keys = Object.keys(w);
  if (keys.length === 1 && keys[0] === "AND" && Array.isArray(w.AND) && w.AND.length === 0) {
    return true;
  }
  if (keys.length === 1 && keys[0] === "OR" && Array.isArray(w.OR) && w.OR.some(isTriviallyTrue)) {
    return true;
  }
  if (keys.length === 1 && keys[0] === "NOT" && isTriviallyFalse(w.NOT)) {
    return true;
  }
  return false;
}

function isTriviallyFalse(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const w = where as Record<string, unknown>;
  const keys = Object.keys(w);
  if (keys.length === 1 && keys[0] === "OR" && Array.isArray(w.OR) && w.OR.length === 0) {
    return true;
  }
  if (keys.length === 1 && keys[0] === "AND" && Array.isArray(w.AND) && w.AND.some(isTriviallyFalse)) {
    return true;
  }
  if (keys.length === 1 && keys[0] === "NOT" && isTriviallyTrue(w.NOT)) {
    return true;
  }
  return false;
}

function buildWhereRecursive<T extends TSchema & { properties: Record<string, TSchema> }>(
  where: WhereClause<T> | undefined,
  softDeleteColumn: string | undefined,
  meta: TableMeta | undefined
): { sql: string; params: SQLQueryBindings[] } {
  const parts: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (softDeleteColumn) {
    parts.push(`"${softDeleteColumn}" IS NULL`);
  }

  if (!where || Object.keys(where).length === 0) {
    if (parts.length === 0) return { sql: "", params: [] };
    return { sql: `WHERE ${parts.join(" AND ")}`, params };
  }

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
        const child = buildWhereRecursive(clause, undefined, meta);
        if (child.sql) {
          parts.push(`(${child.sql.replace(/^WHERE\s+/, "")})`);
          params.push(...child.params);
        }
      }
    }

    if (logic.OR) {
      const orParts: string[] = [];
      const orParams: SQLQueryBindings[] = [];
      for (const clause of logic.OR) {
        if (isTriviallyTrue(clause)) {
          orParts.length = 0;
          break;
        }
        if (isTriviallyFalse(clause)) continue;
        const child = buildWhereRecursive(clause, undefined, meta);
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
        const child = buildWhereRecursive(logic.NOT, undefined, meta);
        if (child.sql) {
          parts.push(`NOT (${child.sql.replace(/^WHERE\s+/, "")})`);
          params.push(...child.params);
        }
      }
    }
  }

  const rawFilter = (where as Record<string, unknown>)._raw;
  if (rawFilter && typeof rawFilter === "object" && "sql" in rawFilter) {
    const raw = rawFilter as { sql: string; params?: SQLQueryBindings[] };
    parts.push(`(${raw.sql})`);
    params.push(...(raw.params ?? []));
  }

  for (const [col, filter] of Object.entries(where)) {
    if (col === "AND" || col === "OR" || col === "NOT" || col === "_raw") continue;
    if (!isFilterShape(filter)) continue;
    const entry = buildFilter(col, filter, meta);
    parts.push(entry.sql);
    params.push(...entry.params);
  }

  if (parts.length === 0) return { sql: "", params: [] };
  return { sql: `WHERE ${parts.join(" AND ")}`, params };
}

export function buildWhere<T extends TSchema & { properties: Record<string, TSchema> }>(
  where: WhereClause<T> | undefined,
  softDeleteColumn?: string | undefined,
  meta?: TableMeta | undefined
): WhereResult {
  if (feature("DEBUG_TRACING")) traceBegin("qb.buildWhere");
  sqlDebug(`buildWhere input`, { where, softDeleteColumn, tableName: meta?.tableName });
  const result = buildWhereRecursive(where, softDeleteColumn, meta);
  sqlDebug(`buildWhere output`, { result, tableName: meta?.tableName });
  if (feature("DEBUG_TRACING")) traceEnd();
  return result;
}

// --- ORDER BY builder ---------------------------------------------------------

export function resolveOrderByColumn(column: string, meta: TableMeta | undefined): string {
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

export function buildOrderBy<T extends TSchema & { properties: Record<string, TSchema> }>(
  orderBy: FindOptions<T>["orderBy"],
  meta: TableMeta | undefined
): string {
  if (feature("DEBUG_TRACING")) traceBegin("qb.buildOrderBy");
  sqlDebug(`buildOrderBy input`, { orderBy, tableName: meta?.tableName });
  try {
    if (!orderBy) {
      sqlDebug(`buildOrderBy output`, { sql: "" });
      return "";
    }
    const clauses: OrderByClause<T>[] = globalThis.Array.isArray(orderBy) ? orderBy : [orderBy];
    if (clauses.length === 0) {
      sqlDebug(`buildOrderBy output`, { sql: "" });
      return "";
    }
    const parts = clauses.map((o) => {
      const colRef = resolveOrderByColumn(o.column, meta);
      sqlDebug(`buildOrderBy column`, { column: o.column, colRef, direction: o.direction ?? "ASC" });
      return `${colRef} ${o.direction ?? "ASC"}`;
    });
    const result = `ORDER BY ${parts.join(", ")}`;
    sqlDebug(`buildOrderBy output`, { result });
    return result;
  } finally { if (feature("DEBUG_TRACING")) traceEnd(); }
}

// --- LIMIT / OFFSET -----------------------------------------------------------

export function buildLimitOffset(
  limit: number | undefined,
  offset: number | undefined
): { sql: string; params: SQLQueryBindings[] } {
  if (feature("DEBUG_TRACING")) traceBegin("qb.buildLimitOffset");
  sqlDebug(`buildLimitOffset input`, { limit, offset });
  const parts: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (limit !== undefined) {
    parts.push("LIMIT ?");
    params.push(limit);
  }
  if (offset !== undefined) {
    parts.push("OFFSET ?");
    params.push(offset);
  }
  const result = { sql: parts.join(" "), params };
  sqlDebug(`buildLimitOffset output`, { result });
  if (feature("DEBUG_TRACING")) traceEnd();
  return result;
}

// --- Full SELECT builder ------------------------------------------------------

export interface SelectResult {
  sql: string;
  params: SQLQueryBindings[];
  countSql: string;
  countParams: SQLQueryBindings[];
}

function resolveSelectColumn(column: string, meta: TableMeta): string[] {
  const exact = meta.columnByName.get(column) || meta.columnByPath.get(column);
  if (exact) return [`"${exact.name}"`];

  const children: string[] = [];
  for (const col of meta.columns) {
    if (col.path && col.path[0] === column) children.push(`"${col.name}"`);
  }
  if (children.length > 0) return children;

  const parts = column.split(".");
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(".");
    const suffix = parts.slice(i).join(".");
    const prefixCol = meta.columnByPath.get(prefix);
    if (prefixCol && prefixCol.sqlType === "TEXT") {
      const alias = parts.join("__");
      return [
        `JSON_EXTRACT("${prefixCol.name}", '$.${suffix.replace(/'/g, "''")}') as "${alias}"`,
      ];
    }
  }

  return [`"${column}"`];
}

export function buildSelectSql<T extends TSchema & { properties: Record<string, TSchema> }>(
  tableName: string,
  opts: FindOptions<T>,
  softDeleteColumn: string | undefined,
  meta: TableMeta | undefined
): SelectResult {
  if (feature("DEBUG_TRACING")) traceBegin("qb.buildSelectSql");
  sqlDebug(`buildSelectSql input`, { tableName, opts, softDeleteColumn, metaColumns: meta?.columns.length, metaSubTables: meta?.subTables.length });
  try {
    const { sql: whereSql, params: whereParams } = buildWhere(
      opts.where,
      opts.includeDeleted ? undefined : softDeleteColumn,
      meta
    );
    const orderSql = buildOrderBy(opts.orderBy, meta);
    const { sql: limitSql, params: limitParams } = buildLimitOffset(
      opts.limit,
      opts.offset
    );

    const selectCols = opts.select && meta
      ? opts.select.flatMap((c) => resolveSelectColumn(c, meta)).join(", ")
      : "*";

    if (opts.distinctOn && opts.distinctOn.length > 0) {
      const groupCols = opts.distinctOn.map((c) => resolveOrderByColumn(c, meta)).join(", ");
      const clauses = [
        `SELECT ${selectCols} FROM "${tableName}"`,
        whereSql,
        `GROUP BY ${groupCols}`,
        orderSql,
        limitSql,
      ]
        .filter(Boolean)
        .join(" ");
      const countClauses = [
        `SELECT COUNT(*) as "_count" FROM (SELECT 1 FROM "${tableName}"`,
        whereSql,
        `GROUP BY ${groupCols})`,
      ]
        .filter(Boolean)
        .join(" ");
      const result = {
        sql: clauses,
        params: [...whereParams, ...limitParams],
        countSql: countClauses,
        countParams: whereParams,
      };
      sqlDebug(`buildSelectSql output`, { tableName, strategy: "distinctOn", result });
      return result;
    }

    const distinctPrefix = opts.distinct ? "DISTINCT " : "";
    const clauses = [
      `SELECT ${distinctPrefix}${selectCols} FROM "${tableName}"`,
      whereSql,
      orderSql,
      limitSql,
    ]
      .filter(Boolean)
      .join(" ");

    let countClauses: string[];
    if (opts.distinct) {
      countClauses = [
        `SELECT COUNT(*) as "_count" FROM (SELECT DISTINCT ${selectCols} FROM "${tableName}"`,
        whereSql,
        `)`,
      ];
    } else {
      countClauses = [
        `SELECT COUNT(*) as "_count" FROM "${tableName}"`,
        whereSql,
      ];
    }

    const result = {
      sql: clauses,
      params: [...whereParams, ...limitParams],
      countSql: countClauses.filter(Boolean).join(" "),
      countParams: whereParams,
    };
    sqlDebug(`buildSelectSql output`, { tableName, strategy: opts.distinct ? "distinct" : "normal", result });
    return result;
  } finally { if (feature("DEBUG_TRACING")) traceEnd(); }
}

export function buildSelect<T extends TSchema & { properties: Record<string, TSchema> }>(
  tableName: string,
  opts: FindOptions<T>,
  softDeleteColumn: string | undefined,
  meta: TableMeta | undefined
): SelectResult {
  if (feature("DEBUG_TRACING")) traceBegin("qb.buildSelect");
  sqlDebug(`buildSelect input`, { tableName, opts, softDeleteColumn, tableNameMeta: meta?.tableName });
  const result = buildSelectSql(tableName, opts, softDeleteColumn, meta);
  sqlDebug(`buildSelect output`, { result });
  if (feature("DEBUG_TRACING")) traceEnd();
  return result;
}

// --- INSERT builder -----------------------------------------------------------

export function buildInsert(
  tableName: string,
  row: Record<string, unknown>
): { sql: string; params: SQLQueryBindings[] } {
  if (feature("DEBUG_TRACING")) traceBegin("qb.buildInsert");
  sqlDebug(`buildInsert input`, { tableName, row });
  const keys = Object.keys(row);
  const cols = keys.map((k) => `"${k}"`).join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  const result = {
    sql: `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders})`,
    params: keys.map((k) => toBinding(row[k])),
  };
  sqlDebug(`buildInsert output`, { result });
  if (feature("DEBUG_TRACING")) traceEnd();
  return result;
}

export function buildInsertMany(
  tableName: string,
  rows: Record<string, unknown>[],
  maxParams = 999,
  colsSql?: string,
  valueGroup?: string,
  keys?: string[]
): Array<{ sql: string; params: SQLQueryBindings[] }> {
  if (feature("DEBUG_TRACING")) traceBegin("qb.buildInsertMany");
  sqlDebug(`buildInsertMany input`, { tableName, rowCount: rows.length, maxParams });
  try {
    if (rows.length === 0) {
      sqlDebug(`buildInsertMany output`, { batches: [] });
      return [];
    }
    const ks = keys ?? Object.keys(rows[0]!);
    const colCount = ks.length;
    const maxRowsPerStmt = Math.floor(maxParams / colCount);
    if (maxRowsPerStmt <= 0) {
      raise("TOO_MANY_COLUMNS", `foxdb: table "${tableName}" has too many columns for multi-value insert`);
    }
    sqlDebug(`buildInsertMany batching`, { keys: ks, colCount, maxParams, maxRowsPerStmt });
    const cols = colsSql ?? ks.map((k) => `"${k}"`).join(", ");
    const vg = valueGroup ?? `(${ks.map(() => "?").join(", ")})`;
    const batches: Array<{ sql: string; params: SQLQueryBindings[] }> = [];
    for (let i = 0; i < rows.length; i += maxRowsPerStmt) {
      const batch = rows.slice(i, i + maxRowsPerStmt);
      const valueGroups = batch.map(() => vg).join(", ");
      const params: SQLQueryBindings[] = keys
        ? batch.flatMap((row) => ks.map((k) => row[k] as SQLQueryBindings))
        : batch.flatMap((row) => ks.map((k) => toBinding(row[k])));
      const sql = `INSERT INTO "${tableName}" (${cols}) VALUES ${valueGroups}`;
      sqlDebug(`buildInsertMany batch`, { start: i, rowCount: batch.length, sql, paramCount: params.length });
      batches.push({ sql, params });
    }
    sqlDebug(`buildInsertMany output`, { batchCount: batches.length, batches });
    return batches;
  } finally { if (feature("DEBUG_TRACING")) traceEnd(); }
}

// --- UPSERT (INSERT OR REPLACE / ON CONFLICT DO UPDATE) ----------------------

export function buildUpsert(
  tableName: string,
  row: Record<string, unknown>,
  conflictCols: string[],
  updateCols: string[]
): { sql: string; params: SQLQueryBindings[] } {
  sqlDebug(`buildUpsert input`, { tableName, row, conflictCols, updateCols });
  const keys = Object.keys(row);
  const cols = keys.map((k) => `"${k}"`).join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  const conflict = conflictCols.map((c) => `"${c}"`).join(", ");
  const updates = updateCols
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(", ");

  const result = {
    sql: `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`,
    params: keys.map((k) => toBinding(row[k])),
  };
  sqlDebug(`buildUpsert output`, { result });
  return result;
}

export function buildUpsertMany(
  tableName: string,
  rows: Record<string, unknown>[],
  conflictCols: string[],
  updateCols: string[],
  maxParams = 999
): Array<{ sql: string; params: SQLQueryBindings[] }> {
  sqlDebug(`buildUpsertMany input`, { tableName, rowCount: rows.length, conflictCols, updateCols, maxParams });
  if (rows.length === 0) {
    sqlDebug(`buildUpsertMany output`, { batches: [] });
    return [];
  }
  const first = rows[0]!;
  const keys = Object.keys(first);
  const colCount = keys.length;
  const maxRowsPerStmt = Math.floor(maxParams / colCount);
  if (maxRowsPerStmt <= 0) {
    raise("TOO_MANY_COLUMNS", `foxdb: table "${tableName}" has too many columns for multi-value upsert`);
  }
  sqlDebug(`buildUpsertMany batching`, { keys, colCount, maxParams, maxRowsPerStmt });
  const conflict = conflictCols.map((c) => `"${c}"`).join(", ");
  const updates = updateCols
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(", ");
  const batches: Array<{ sql: string; params: SQLQueryBindings[] }> = [];
  for (let i = 0; i < rows.length; i += maxRowsPerStmt) {
    const batch = rows.slice(i, i + maxRowsPerStmt);
    const cols = keys.map((k) => `"${k}"`).join(", ");
    const valueGroups = batch.map(() => {
      const ph = keys.map(() => "?").join(", ");
      return `(${ph})`;
    }).join(", ");
    const params = batch.flatMap((row) => keys.map((k) => toBinding(row[k])));
    const sql = `INSERT INTO "${tableName}" (${cols}) VALUES ${valueGroups} ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`;
    sqlDebug(`buildUpsertMany batch`, { start: i, rowCount: batch.length, sql, paramCount: params.length });
    batches.push({ sql, params });
  }
  sqlDebug(`buildUpsertMany output`, { batchCount: batches.length, batches });
  return batches;
}

// --- UPDATE builder -----------------------------------------------------------

export function buildUpdate<T extends TSchema & { properties: Record<string, TSchema> }>(
  tableName: string,
  pk: string,
  pkValue: unknown,
  patch: Record<string, unknown>
): { sql: string; params: SQLQueryBindings[] } {
  if (feature("DEBUG_TRACING")) traceBegin("qb.buildUpdate");
  sqlDebug(`buildUpdate input`, { tableName, pk, pkValue, patch });
  const entries = Object.entries(patch).filter(([k]) => k !== pk);
  if (entries.length === 0) {
    raise("NO_COLUMNS_TO_UPDATE", "foxdb: no columns to update", { table: tableName });
  }
  const sets = entries.map(([k]) => `"${k}" = ?`).join(", ");
  const result = {
    sql: `UPDATE "${tableName}" SET ${sets} WHERE "${pk}" = ?`,
    params: [...entries.map(([, v]) => toBinding(v)), toBinding(pkValue)],
  };
  sqlDebug(`buildUpdate output`, { result });
  if (feature("DEBUG_TRACING")) traceEnd();
  return result;
}

export function buildUpdateWhere<T extends TSchema & { properties: Record<string, TSchema> }>(
  tableName: string,
  patch: Record<string, unknown>,
  where: WhereClause<T>,
  softDeleteColumn: string | undefined,
  meta: TableMeta | undefined
): { sql: string; params: SQLQueryBindings[] } {
  if (feature("DEBUG_TRACING")) traceBegin("qb.buildUpdateWhere");
  sqlDebug(`buildUpdateWhere input`, { tableName, patch, where, softDeleteColumn, tableNameMeta: meta?.tableName });
  const entries = Object.entries(patch);
  if (entries.length === 0) {
    raise("NO_COLUMNS_TO_UPDATE", "foxdb: no columns to update", { table: tableName });
  }
  const sets = entries.map(([k]) => `"${k}" = ?`).join(", ");
  const { sql: whereSql, params: whereParams } = buildWhere(where, softDeleteColumn, meta);
  const result = {
    sql: `UPDATE "${tableName}" SET ${sets} ${whereSql}`.trim(),
    params: [...entries.map(([, v]) => toBinding(v)), ...whereParams],
  };
  sqlDebug(`buildUpdateWhere output`, { result });
  if (feature("DEBUG_TRACING")) traceEnd();
  return result;
}

// --- DELETE builder -----------------------------------------------------------

export function buildDelete<T extends TSchema & { properties: Record<string, TSchema> }>(
  tableName: string,
  where: WhereClause<T>,
  meta: TableMeta | undefined
): { sql: string; params: SQLQueryBindings[] } {
  sqlDebug(`buildDelete input`, { tableName, where, tableNameMeta: meta?.tableName });
  const { sql: whereSql, params } = buildWhere(where, undefined, meta);
  const result = {
    sql: `DELETE FROM "${tableName}" ${whereSql}`.trim(),
    params,
  };
  sqlDebug(`buildDelete output`, { result });
  return result;
}
