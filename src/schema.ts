/**
 * foxdb/src/schema.ts
 * Runtime schema introspection - walks TObject properties and produces
 * the SQL column/table DDL as well as the flatten/hydrate mappings.
 * Uses typebox 1.x guard functions (IsObject, IsArray, etc.)
 */

import {
  IsObject,
  IsArray,
  IsString,
  IsNumber,
  IsInteger,
  IsBoolean,
  IsLiteral,
  IsOptional,
  type TObject,
  type TSchema,
  type TProperties,
  type TLiteral,
} from "typebox";
import type { ColumnCodec } from "./codec.ts";

// ─── Column metadata ──────────────────────────────────────────────────────────

/** @category Advanced */
export type SqliteType = "TEXT" | "INTEGER" | "REAL" | "BLOB";

/** @category Advanced */
export interface ColumnMeta {
  name: string;
  sqlType: SqliteType;
  nullable: boolean;
  /** True if this is actually an `Optional` wrapper */
  optional: boolean;
}

/** @category Advanced */
export interface SubTableMeta {
  /** e.g. "lineItems" */
  fieldName: string;
  /** e.g. "sales__lineItems" */
  tableName: string;
  /** Schema of a single item in the array */
  itemSchema: TSchema & { properties: Record<string, TSchema> };
  /** Columns of the sub-table row (owner PK is prepended automatically) */
  columns: ColumnMeta[];
}

/** @category Advanced */
export interface TableMeta {
  tableName: string;
  columns: ColumnMeta[];
  subTables: SubTableMeta[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function unwrapOptional(schema: TSchema): { schema: TSchema; optional: boolean } {
  // In typebox 1.x optional is a brand on the schema itself
  if (IsOptional(schema)) {
    // Optional wraps the inner schema - we treat the inner schema for type mapping
    // The '~optional' brand is on the schema, not a wrapper object
    return { schema, optional: true };
  }
  return { schema, optional: false };
}

/**
 * Detect schemas like `Type.Union([Type.String(), Type.Null()])` which are
 * nullable without being wrapped in `Type.Optional()`.
 */
function isNullableUnion(schema: TSchema): boolean {
  const s = schema as Record<string, unknown>;
  if (s.anyOf && Array.isArray(s.anyOf)) {
    return (s.anyOf as Array<Record<string, unknown>>).some(
      (item) => item.type === "null"
    );
  }
  return false;
}

function schemaToSqlType(schema: TSchema): SqliteType {
  if (IsInteger(schema)) return "INTEGER";
  if (IsNumber(schema)) return "REAL";
  if (IsBoolean(schema)) return "INTEGER"; // SQLite has no bool; 0/1
  if (IsString(schema)) return "TEXT";
  if (IsLiteral(schema)) {
    const v: unknown = schema.const;
    if (typeof v === "number") return Number.isInteger(v) ? "INTEGER" : "REAL";
    if (typeof v === "boolean") return "INTEGER";
    return "TEXT";
  }
  // Fallback - JSON-encode anything complex that slips through
  return "TEXT";
}

export function buildColumns(properties: TProperties): ColumnMeta[] {
  const cols: ColumnMeta[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (IsArray(raw)) {
      const { optional } = unwrapOptional(raw);
      // Arrays of objects → handled as sub-table (skip here)
      if (IsObject(raw.items)) continue;
      // Arrays of primitives → JSON TEXT
      cols.push({ name, sqlType: "TEXT", nullable: optional, optional });
      continue;
    }
    if (IsObject(raw)) continue; // nested objects are JSON-encoded as TEXT
    const { schema, optional } = unwrapOptional(raw);
    const nullable = optional || isNullableUnion(schema);
    cols.push({
      name,
      sqlType: IsObject(schema) ? "TEXT" : schemaToSqlType(schema),
      nullable,
      optional: nullable,
    });
  }
  // Also handle nested plain objects encoded as JSON TEXT
  for (const [name, raw] of Object.entries(properties)) {
    if (IsObject(raw)) {
      cols.push({ name, sqlType: "TEXT", nullable: false, optional: false });
    }
  }
  return cols;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** @category Advanced */
export function introspectTable(
  tableName: string,
  schema: TSchema & { properties: Record<string, TSchema> }
): TableMeta {
  const columns: ColumnMeta[] = [];
  const subTables: SubTableMeta[] = [];

  for (const [fieldName, raw] of Object.entries(schema.properties)) {
    if (IsArray(raw) && IsObject(raw.items)) {
      // Sub-table
      const itemSchema = raw.items;
      const subTableName = `${tableName}__${fieldName}`;
      subTables.push({
        fieldName,
        tableName: subTableName,
        itemSchema,
        columns: buildColumns(itemSchema.properties),
      });
    } else if (IsArray(raw)) {
      const { optional } = unwrapOptional(raw);
      // Array of primitives → JSON TEXT column
      columns.push({ name: fieldName, sqlType: "TEXT", nullable: optional, optional });
    } else if (IsObject(raw)) {
      // Nested plain object → JSON-encoded TEXT column
      columns.push({ name: fieldName, sqlType: "TEXT", nullable: false, optional: false });
    } else {
      const { schema: inner, optional } = unwrapOptional(raw);
      const nullable = optional || isNullableUnion(inner);
      columns.push({
        name: fieldName,
        sqlType: schemaToSqlType(inner),
        nullable,
        optional: nullable,
      });
    }
  }

  return { tableName, columns, subTables };
}

// ─── DDL generation ───────────────────────────────────────────────────────────

/** @category Advanced */
export function buildCreateTableSQL(
  meta: TableMeta,
  primaryKey: string
): string[] {
  const stmts: string[] = [];

  // Main table
  const colDefs = meta.columns.map((c) => {
    const notNull = !c.nullable ? " NOT NULL" : "";
    const pk = c.name === primaryKey ? " PRIMARY KEY" : "";
    return `  "${c.name}" ${c.sqlType}${pk}${notNull}`;
  });
  stmts.push(
    `CREATE TABLE IF NOT EXISTS "${meta.tableName}" (\n${colDefs.join(",\n")}\n)`
  );

  // Sub-tables - each gets an auto _rowid_ and a FK back to owner
  for (const sub of meta.subTables) {
    const subCols = [
      `  "_id" INTEGER PRIMARY KEY AUTOINCREMENT`,
      `  "_owner_id" ${meta.columns.find((c) => c.name === primaryKey)?.sqlType ?? "TEXT"} NOT NULL`,
      `  "_index" INTEGER NOT NULL`,
      ...sub.columns.map((c) => {
        const notNull = !c.nullable ? " NOT NULL" : "";
        return `  "${c.name}" ${c.sqlType}${notNull}`;
      }),
    ];
    stmts.push(
      `CREATE TABLE IF NOT EXISTS "${sub.tableName}" (\n${subCols.join(",\n")}\n)`
    );
    // Index on owner FK for fast hydration
    stmts.push(
      `CREATE INDEX IF NOT EXISTS "idx_${sub.tableName}__owner" ON "${sub.tableName}" ("_owner_id")`
    );
  }

  return stmts;
}

export function buildIndexSQL(
  tableName: string,
  columns: string[],
  unique: boolean,
  name?: string,
  where?: string,
  include?: string[]
): string {
  const idxName = name ?? `idx_${tableName}__${columns.join("_")}`;
  const uniq = unique ? "UNIQUE " : "";
  const cols = columns.map((c) => `"${c}"`).join(", ");
  // SQLite in this environment does not support the INCLUDE clause;
  // silently drop included columns so the API remains portable.
  const wh = where ? ` WHERE ${where}` : "";
  return `CREATE ${uniq}INDEX IF NOT EXISTS "${idxName}" ON "${tableName}" (${cols})${wh}`;
}

// ─── Flatten / hydrate ────────────────────────────────────────────────────────

/**
 * Flatten a full user object into the main-table row object.
 * Arrays are stripped; nested objects are JSON-stringified.
 */
export function flattenRow(
  obj: Record<string, unknown>,
  meta: TableMeta,
  codecs?: Map<string, ColumnCodec>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const col of meta.columns) {
    const v = obj[col.name];
    let encoded: unknown;
    if (v === undefined || v === null) {
      encoded = null;
    } else if (col.sqlType === "TEXT" && typeof v === "object") {
      encoded = JSON.stringify(v);
    } else if (col.sqlType === "INTEGER" && typeof v === "boolean") {
      encoded = v ? 1 : 0;
    } else {
      encoded = toSqliteScalar(v);
    }
    const codec = codecs?.get(col.name);
    row[col.name] = codec ? codec.encode(encoded) : encoded;
  }
  return row;
}

/**
 * Flatten sub-table items for a given field, attaching owner PK.
 */
export function flattenSubRows(
  ownerPk: SqliteScalar,
  items: unknown[],
  sub: SubTableMeta,
  codecs?: Map<string, ColumnCodec>
): Array<Record<string, unknown>> {
  return items.map((item, idx) => {
    if (item === null || typeof item !== "object") {
      throw new TypeError("Sub-table item must be an object");
    }
    const obj = item as Record<string, unknown>;
    const row: Record<string, unknown> = {
      _owner_id: ownerPk,
      _index: idx,
    };
    for (const col of sub.columns) {
      const v = obj[col.name];
      let encoded: unknown;
      if (v === undefined || v === null) {
        encoded = null;
      } else if (col.sqlType === "TEXT" && typeof v === "object") {
        encoded = JSON.stringify(v);
      } else if (col.sqlType === "INTEGER" && typeof v === "boolean") {
        encoded = v ? 1 : 0;
      } else {
        encoded = toSqliteScalar(v);
      }
      const codec = codecs?.get(col.name);
      row[col.name] = codec ? codec.encode(encoded) : encoded;
    }
    return row;
  });
}

export type SqliteScalar = string | number | boolean | null | bigint;

function toSqliteScalar(v: unknown): SqliteScalar {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Rehydrate a flat DB row back into the full object shape.
 * Sub-table arrays must be provided separately and are spliced in.
 */
export function hydrateRow(
  flat: Record<string, unknown>,
  meta: TableMeta,
  subRows: Map<string, Record<string, unknown>[]>,
  codecs?: Map<string, ColumnCodec>,
  select?: string[],
  include?: string[]
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};

  const columns = select
    ? meta.columns.filter((c) => select.includes(c.name))
    : meta.columns;

  for (const col of columns) {
    let v = flat[col.name];
    const codec = codecs?.get(col.name);
    if (codec) {
      v = codec.decode(v);
    }
    if (col.sqlType === "TEXT" && typeof v === "string") {
      // Try JSON parse for objects that were stringified
      try {
        const parsed = JSON.parse(v);
        // Only use parsed result if it's an object/array (not a plain string value)
        obj[col.name] = typeof parsed === "object" ? parsed : v;
      } catch {
        obj[col.name] = v;
      }
    } else if (col.sqlType === "INTEGER" && typeof v === "number") {
      // Detect boolean columns by checking if schema says boolean - fallback: keep as number
      // We'll leave this as-is; codec layer can handle it if needed
      obj[col.name] = v;
    } else {
      obj[col.name] = v ?? null;
    }
  }

  for (const sub of meta.subTables) {
    if (include && !include.includes(sub.fieldName)) {
      obj[sub.fieldName] = [];
    } else {
      obj[sub.fieldName] = subRows.get(sub.tableName) ?? [];
    }
  }

  return obj;
}
