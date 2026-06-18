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
import type { GeneratedColumnConfig, DBValue } from "./types.ts";
import { feature } from "bun:bundle";
import { traceBegin, traceEnd, sqlDebug } from "./tracing.ts";

// --- Column metadata ----------------------------------------------------------

/** @category Advanced */
export type SqliteType = "TEXT" | "INTEGER" | "REAL" | "BLOB";

/** @category Advanced */
export interface ColumnMeta {
  name: string;
  sqlType: SqliteType;
  nullable: boolean;
  /** True if this is actually an `Optional` wrapper */
  optional: boolean;
  /** Path segments for flattened nested columns, e.g. ["Status", "Group"] */
  path?: string[];
  /** True if the underlying schema is a boolean (stored as INTEGER) */
  isBoolean?: boolean;
  /** True if this is a generated column */
  generated?: boolean;
  /** Expression for generated columns */
  generatedExpr?: string;
  /** Pre-built getter function for flattenRow (set during introspectTable) */
  _get?: (obj: Record<string, unknown>) => unknown;
}

type SubTableMetaCommon = {
  fieldName: string;
  tableName: string;
  columns: ColumnMeta[];
  columnByName: Map<string, ColumnMeta>;
  columnByPath: Map<string, ColumnMeta>;
  /** Pre-built INSERT column SQL fragment, e.g. `"_owner_id", "_index", "col1", "col2"` */
  insertColsSql?: string;
  /** Pre-built INSERT value group fragment, e.g. `(?, ?, ?, ?)` */
  insertValueGroup?: string;
  /** Ordered column names for INSERT */
  insertColumnNames?: string[];
};

/** @category Advanced */
export type SubTableMeta = SubTableMetaCommon & (
  | {
    isScalar: true;
    scalarType: SqliteType;
    itemSchema?: never;
  }
  | {
    isScalar?: false;
    scalarType?: never;
    itemSchema?: TSchema & { properties: Record<string, TSchema> };
  }
);

/** @category Advanced */
export interface TableMeta {
  tableName: string;
  columns: ColumnMeta[];
  subTables: SubTableMeta[];
  /** Map from dotted path → ColumnMeta for O(1) resolution */
  columnByPath: Map<string, ColumnMeta>;
  /** Map from column name → ColumnMeta for O(1) resolution */
  columnByName: Map<string, ColumnMeta>;
  /** The PK column name of the parent table - used for sub-table filter SQL */
  primaryKey?: string;
  /** Non-generated columns - pre-filtered for flattenRow / INSERT / UPDATE */
  insertColumns: ColumnMeta[];
  /** Precomputed ordered column names for INSERT SQL */
  insertColumnNames: string[];
}

// --- Helpers ------------------------------------------------------------------

/** TSchema with index signature for dynamic property access */
type SchemaRecord = TSchema & Record<string, unknown>;

function toRecord(schema: TSchema): SchemaRecord {
  return schema as SchemaRecord;
}

function unwrapOptional(schema: TSchema): { schema: TSchema; optional: boolean } {
  if (IsOptional(schema)) {
    return { schema, optional: true };
  }
  return { schema, optional: false };
}

function schemaAnyOfMembers(schema: TSchema): TSchema[] | null {
  const obj = toRecord(schema);
  if (obj.anyOf && Array.isArray(obj.anyOf)) {
    return obj.anyOf as TSchema[];
  }
  return null;
}

function schemaConstValue(schema: TSchema): unknown {
  return toRecord(schema).const;
}

function schemaProperties(schema: TSchema): Record<string, TSchema> | null {
  const obj = toRecord(schema);
  if (obj.properties && typeof obj.properties === "object" && obj.properties !== null) {
    return obj.properties as Record<string, TSchema>;
  }
  return null;
}

function schemaItems(schema: TSchema): TSchema | null {
  const obj = toRecord(schema);
  if (obj.items && typeof obj.items === "object" && obj.items !== null) {
    return obj.items as TSchema;
  }
  return null;
}

/**
 * Detect schemas like `Type.Union([Type.String(), Type.Null()])` which are
 * nullable without being wrapped in `Type.Optional()`.
 */
function isNullableUnion(schema: TSchema): boolean {
  const members = schemaAnyOfMembers(schema);
  if (members) {
    return members.some((item) => {
      const obj = toRecord(item);
      return obj.type === "null";
    });
  }
  return false;
}

function inferScalarSqlType(schema: TSchema): SqliteType {
  if (IsInteger(schema) || IsBoolean(schema)) return "INTEGER";
  if (IsNumber(schema)) return "REAL";
  return "TEXT";
}

function schemaToSqlType(schema: TSchema): SqliteType {
  if (IsInteger(schema)) return "INTEGER";
  if (IsNumber(schema)) return "REAL";
  if (IsBoolean(schema)) return "INTEGER";
  if (IsString(schema)) return "TEXT";
  if (IsLiteral(schema)) {
    const v = schemaConstValue(schema);
    if (typeof v === "number") return Number.isInteger(v) ? "INTEGER" : "REAL";
    if (typeof v === "boolean") return "INTEGER";
    return "TEXT";
  }
  if (isNullableUnion(schema)) {
    const members = schemaAnyOfMembers(schema);
    if (members) {
      const nonNull = members.find((m) => toRecord(m).type !== "null");
      if (nonNull) return schemaToSqlType(nonNull);
    }
  }
  return "TEXT";
}

function isScalarLike(schema: TSchema): boolean {
  if (IsString(schema) || IsNumber(schema) || IsInteger(schema) || IsBoolean(schema) || IsLiteral(schema))
    return true;
  if (isNullableUnion(schema)) {
    const members = schemaAnyOfMembers(schema);
    if (members) {
      const nonNull = members.find((m) => toRecord(m).type !== "null");
      if (!nonNull) return false;
      return isScalarLike(nonNull);
    }
  }
  return false;
}

function shouldFlattenObject(schema: TSchema): boolean {
  if (!IsObject(schema)) return false;
  const props = schemaProperties(schema);
  if (!props) return false;
  for (const raw of Object.values(props)) {
    if (IsArray(raw) || IsObject(raw)) continue;
    const { schema: inner } = unwrapOptional(raw);
    if (IsArray(inner) || IsObject(inner)) continue;
    if (isScalarLike(inner)) continue;
    return false;
  }
  return true;
}

export function buildColumns(
  properties: TProperties,
  prefix: string[] = [],
  depth = 0,
  skipObjectArrays = false
): ColumnMeta[] {
  const cols: ColumnMeta[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (IsArray(raw)) {
      const { optional } = unwrapOptional(raw);
      // Arrays of objects → sub-table ONLY when explicitly told to skip
      if (skipObjectArrays && depth === 0 && IsObject(raw.items)) {
        sqlDebug(`buildColumns skip array ${name}`, { depth, reason: "top-level object array → handled as sub-table" });
        continue;
      }
      // Everywhere else (inside flattened objects, or sub-tables) → JSON TEXT
      const colName = prefix.length > 0 ? [...prefix, name].join("__") : name;
      cols.push({
        name: colName,
        sqlType: "TEXT",
        nullable: optional,
        optional,
        path: prefix.length > 0 ? [...prefix, name] : undefined,
      });
      sqlDebug(`buildColumns array ${name} → ${colName}`, { depth, sqlType: "TEXT", reason: depth === 0 ? "top-level array not of objects → scalar sub-table or JSON TEXT" : "nested array → JSON TEXT" });
      continue;
    }
    if (IsObject(raw) && depth < 2 && shouldFlattenObject(raw)) {
      sqlDebug(`buildColumns flatten ${name}`, { depth, reason: "nested object at depth < 2 with only scalar children → flatten columns" });
      cols.push(...buildColumns(raw.properties, [...prefix, name], depth + 1, skipObjectArrays));
      continue;
    }
    if (IsObject(raw)) {
      const reason = depth >= 2 ? `depth ${depth} >= 2 → store as JSON TEXT` : "contains non-scalar children or arrays → store as JSON TEXT";
      sqlDebug(`buildColumns object ${name} → JSON TEXT`, { depth, reason });
    }
    const { schema, optional } = unwrapOptional(raw);
    const nullable = optional || isNullableUnion(schema);
    const colName = prefix.length > 0 ? [...prefix, name].join("__") : name;
    const finalSqlType = IsObject(schema) ? "TEXT" : schemaToSqlType(schema);
    cols.push({
      name: colName,
      sqlType: finalSqlType,
      nullable,
      optional: nullable,
      path: prefix.length > 0 ? [...prefix, name] : undefined,
      isBoolean: IsBoolean(schema),
    });
    if (prefix.length > 0) {
      sqlDebug(`buildColumns scalar ${name} → ${colName}`, { depth, sqlType: finalSqlType, nullable, path: [...prefix, name] });
    }
  }
  return cols;
}

// --- Public API ---------------------------------------------------------------

/** Convert GeneratedColumnConfig object to runtime format for introspectTable */
export function convertGeneratedConfig(
  config: GeneratedColumnConfig | undefined
): Array<{ name: string; expr: string; sqlType?: SqliteType }> | undefined {
  if (!config) return undefined;
  const result: Array<{ name: string; expr: string; sqlType?: SqliteType }> = [];
  for (const [name, def] of Object.entries(config)) {
    result.push({
      name,
      expr: def.expr,
      sqlType: schemaToSqlType(def.type),
    });
  }
  return result;
}

/** @category Advanced */
export function introspectTable(
  tableName: string,
  schema: TSchema & { properties: Record<string, TSchema> },
  generated?: Array<{ name: string; expr: string; sqlType?: SqliteType }>,
  primaryKey?: string
): TableMeta {
  const subTables: SubTableMeta[] = [];
  const arrayFieldNames = new Set<string>();

  sqlDebug(`introspect.${tableName} start`, {
    fieldCount: Object.keys(schema.properties).length,
    fields: Object.keys(schema.properties),
    generatedColumns: generated?.map((g) => g.name),
  });

  for (const [fieldName, raw] of Object.entries(schema.properties)) {
    if (IsArray(raw)) {
      arrayFieldNames.add(fieldName);
      if (IsObject(raw.items)) {
        const itemSchema = raw.items;
        const subTableName = `${tableName}__${fieldName}`;
        const subCols = buildColumns(itemSchema.properties, [], 0, false);
        sqlDebug(`introspect.${tableName} field ${fieldName} → sub-table`, {
          subTableName,
          columnCount: subCols.length,
          columns: subCols.map((c) => ({ name: c.name, sqlType: c.sqlType, path: c.path })),
          reason: "top-level array of objects → separate sub-table with FK back to owner",
        });
        const subByName = new Map<string, ColumnMeta>();
        const subByPath = new Map<string, ColumnMeta>();
        for (const col of subCols) {
          subByName.set(col.name, col);
          if (col.path) subByPath.set(col.path.join("."), col);
        }
        const insertCols = ["_owner_id", "_index", ...subCols.map((c) => c.name)];
        const insertColsSql = insertCols.map((c) => `"${c}"`).join(", ");
        const insertValueGroup = `(${insertCols.map(() => "?").join(", ")})`;
        subTables.push({
          fieldName,
          tableName: subTableName,
          itemSchema,
          columns: subCols,
          columnByName: subByName,
          columnByPath: subByPath,
          insertColsSql,
          insertValueGroup,
          insertColumnNames: insertCols,
        });
      } else {
        // Scalar array - stored as a sub-table with a _value column
        const scalarType = inferScalarSqlType(raw.items);
        const subTableName = `${tableName}__${fieldName}`;
        sqlDebug(`introspect.${tableName} field ${fieldName} → scalar sub-table`, {
          subTableName,
          scalarType,
          reason: "top-level array of primitives → scalar sub-table with _value column",
        });
        const _valueCol: ColumnMeta = {
          name: "_value",
          sqlType: scalarType,
          nullable: false,
          optional: false,
        };
        const subByName = new Map<string, ColumnMeta>([["_value", _valueCol]]);
        const subByPath = new Map<string, ColumnMeta>();
        const insertCols = ["_owner_id", "_index", "_value"];
        subTables.push({
          fieldName,
          tableName: subTableName,
          columns: [_valueCol],
          columnByName: subByName,
          columnByPath: subByPath,
          isScalar: true,
          scalarType,
          insertColsSql: insertCols.map((c) => `"${c}"`).join(", "),
          insertValueGroup: `(${insertCols.map(() => "?").join(", ")})`,
          insertColumnNames: insertCols,
        });
      }
    }
  }

  const columns = buildColumns(schema.properties, [], 0, true)
    .filter(col => !arrayFieldNames.has(col.name));

  sqlDebug(`introspect.${tableName} columns built`, {
    totalScalar: columns.length,
    columnNames: columns.map((c) => c.name),
    flatColumns: columns.filter((c) => !c.path).length,
    pathColumns: columns.filter((c) => c.path).length,
    textJsonColumns: columns.filter((c) => c.sqlType === "TEXT" && !c.path).length,
    subTables: subTables.map((s) => ({ fieldName: s.fieldName, tableName: s.tableName, columns: s.columns.length })),
  });

  if (generated) {
    for (const g of generated) {
      columns.push({
        name: g.name,
        sqlType: g.sqlType ?? "TEXT",
        nullable: true,
        optional: true,
        generated: true,
        generatedExpr: g.expr,
      });
    }
  }

  const columnByPath = new Map<string, ColumnMeta>();
  const columnByName = new Map<string, ColumnMeta>();
  for (const col of columns) {
    columnByName.set(col.name, col);
    if (col.path) columnByPath.set(col.path.join("."), col);
  }
  const insertColumns = columns.filter((c) => !c.generated);
  const insertColumnNames = insertColumns.map((c) => c.name);

  // Pre-build getter functions for flattenRow
  for (const col of insertColumns) {
    if (col.path) {
      const p = col.path;
      if (p.length === 1) {
        const k = p[0]!;
        col._get = (obj: Record<string, unknown>) => (k in obj ? obj[k] : undefined);
      } else if (p.length === 2) {
        const k1 = p[0]!, k2 = p[1]!;
        col._get = (obj: Record<string, unknown>) => {
          const o = obj[k1];
          return o && typeof o === "object" ? (o as Record<string, unknown>)[k2] : undefined;
        };
      } else {
        col._get = (obj: Record<string, unknown>) => getValueAtPath(obj, p);
      }
    } else {
      const k = col.name;
      col._get = (obj: Record<string, unknown>) => obj[k];
    }
  }

  return { tableName, columns, subTables, columnByPath, columnByName, primaryKey, insertColumns, insertColumnNames };
}

// --- DDL generation -----------------------------------------------------------

/** @category Advanced */
export function buildCreateTableSQL(
  meta: TableMeta,
  primaryKey: string,
  autoIndex = true
): string[] {
  const stmts: string[] = [];

  // Main table
  sqlDebug(`ddl.mainTable building ${meta.tableName}`, {
    totalColumns: meta.columns.length,
    primaryKey,
    scalarColumns: meta.columns.filter((c) => !c.generated).length,
    generatedColumns: meta.columns.filter((c) => c.generated).length,
    subTables: meta.subTables.map((s) => s.fieldName),
  });
  const colDefs = meta.columns.map((c) => {
    const notNull = !c.nullable ? " NOT NULL" : "";
    const pk = c.name === primaryKey ? " PRIMARY KEY" : "";
    const generated = c.generated && c.generatedExpr ? ` GENERATED ALWAYS AS (${c.generatedExpr}) STORED` : "";
    return `  "${c.name}" ${c.sqlType}${pk}${notNull}${generated}`;
  });
  const mainSql = `CREATE TABLE IF NOT EXISTS "${meta.tableName}" (\n${colDefs.join(",\n")}\n)`;
  stmts.push(mainSql);
  sqlDebug(`ddl.mainTable SQL for ${meta.tableName}`, { sql: mainSql });

  // Sub-tables - each gets an auto _rowid_ and a FK back to owner with CASCADE
  for (const sub of meta.subTables) {
    const pkColMeta = meta.columns.find((c) => c.name === primaryKey);
    const pkType = pkColMeta?.sqlType ?? "TEXT";
    const fkRef = `REFERENCES "${meta.tableName}"("${primaryKey}") ON DELETE CASCADE`;
    if (sub.isScalar) {
      sqlDebug(`ddl.subTable scalar for ${sub.fieldName}`, {
        tableName: sub.tableName,
        scalarType: sub.scalarType,
        ownerPkType: pkType,
        reason: `top-level array of primitives → scalar sub-table with FK CASCADE`,
      });
      const subSql = `CREATE TABLE IF NOT EXISTS "${sub.tableName}" (\n` +
        `  "_id" INTEGER PRIMARY KEY AUTOINCREMENT,\n` +
        `  "_owner_id" ${pkType} NOT NULL ${fkRef},\n` +
        `  "_index" INTEGER NOT NULL,\n` +
        `  "_value" ${sub.scalarType} NOT NULL\n)`;
      stmts.push(subSql);
      sqlDebug(`ddl.subTable SQL for ${sub.tableName}`, { sql: subSql });

      const idxOwner = `CREATE INDEX IF NOT EXISTS "idx_${sub.tableName}__owner" ON "${sub.tableName}" ("_owner_id")`;
      stmts.push(idxOwner);
      sqlDebug(`ddl.index for ${sub.tableName}`, { sql: idxOwner, reason: "FK index for hydration + CASCADE lookups" });

      const idxValue = `CREATE INDEX IF NOT EXISTS "idx_${sub.tableName}__value" ON "${sub.tableName}" ("_value")`;
      stmts.push(idxValue);
      sqlDebug(`ddl.index for ${sub.tableName}`, { sql: idxValue, reason: "value lookups for arraySome/arrayNot/contains filters" });
    } else {
      sqlDebug(`ddl.subTable object-array for ${sub.fieldName}`, {
        tableName: sub.tableName,
        columnCount: sub.columns.length,
        columns: sub.columns.map((c) => c.name),
        reason: `top-level array of objects → object sub-table with FK CASCADE`,
      });
      const ownerType = pkType;
      const subCols = [
        `  "_id" INTEGER PRIMARY KEY AUTOINCREMENT`,
        `  "_owner_id" ${ownerType} NOT NULL ${fkRef}`,
        `  "_index" INTEGER NOT NULL`,
        ...sub.columns.map((c) => {
          const notNull = !c.nullable ? " NOT NULL" : "";
          return `  "${c.name}" ${c.sqlType}${notNull}`;
        }),
      ];
      const subSql = `CREATE TABLE IF NOT EXISTS "${sub.tableName}" (\n${subCols.join(",\n")}\n)`;
      stmts.push(subSql);
      sqlDebug(`ddl.subTable SQL for ${sub.tableName}`, { sql: subSql });

      const idxOwner = `CREATE INDEX IF NOT EXISTS "idx_${sub.tableName}__owner" ON "${sub.tableName}" ("_owner_id")`;
      stmts.push(idxOwner);
      sqlDebug(`ddl.index for ${sub.tableName}`, { sql: idxOwner, reason: "FK index for hydration + CASCADE lookups" });

      if (autoIndex) {
        let autoIndexed = 0;
        for (const col of sub.columns) {
          if (!col.path && col.sqlType === "TEXT") {
            const idxCol = `CREATE INDEX IF NOT EXISTS "idx_${sub.tableName}__${col.name}" ON "${sub.tableName}" ("${col.name}")`;
            stmts.push(idxCol);
            autoIndexed++;
            sqlDebug(`ddl.index for ${sub.tableName}`, { sql: idxCol, reason: `auto-index TEXT column "${col.name}" for WHERE / ORDER BY` });
          }
        }
        sqlDebug(`ddl.autoIndex summary for ${sub.tableName}`, {
          autoIndexed,
          totalColumns: sub.columns.length,
          note: autoIndexed > 0 ? "TEXT columns auto-indexed. Set autoIndex: false in table() to disable." : "no TEXT columns to auto-index",
        });
      } else {
        sqlDebug(`ddl.autoIndex summary for ${sub.tableName}`, { autoIndexed: 0, note: "autoIndex disabled. only _owner_id indexed." });
      }
    }
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

// --- Flatten / hydrate --------------------------------------------------------

/**
 * Flatten a full user object into the main-table row object.
 * Arrays are stripped; nested objects are JSON-stringified.
 */
function encodeValue(v: unknown, sqlType: SqliteType): DBValue {
  if (v === undefined || v === null) return null;
  if (sqlType === "TEXT" && typeof v === "object") return JSON.stringify(v);
  if (sqlType === "INTEGER" && typeof v === "boolean") return v ? 1 : 0;
  return toSqliteScalar(v);
}

function encodeValueWithCodec(v: unknown, sqlType: SqliteType, codec: ColumnCodec | undefined): DBValue {
  const encoded = encodeValue(v, sqlType);
  if (!codec) return encoded;
  return codec.encode(encoded);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

function getValueAtPath(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = asRecord(current)[key];
  }
  return current;
}

function setValueAtPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (!(key in current)) current[key] = {};
    current = asRecord(current[key]);
  }
  current[path[path.length - 1]!] = value;
}

export function flattenRow(
  obj: Record<string, unknown>,
  meta: TableMeta,
  codecs?: Map<string, ColumnCodec>
): Record<string, unknown> {
  if (feature("DEBUG_TRACING")) traceBegin("schema.flattenRow");
  const row: Record<string, unknown> = {};
  const hasCodecs = codecs?.size;
  for (const col of meta.insertColumns) {
    const v = col._get!(obj);
    const encoded = encodeValue(v, col.sqlType);
    if (hasCodecs) {
      const codec = codecs!.get(col.name);
      row[col.name] = codec ? codec.encode(encoded) : encoded;
    } else {
      row[col.name] = encoded;
    }
  }
  if (feature("DEBUG_TRACING")) traceEnd();
  return row;
}

/**
 * Flatten only the columns present in a partial patch object.
 * Missing columns are omitted so they are not overwritten in UPDATE ... SET.
 */
export function flattenPatch(
  obj: Record<string, unknown>,
  meta: TableMeta,
  codecs?: Map<string, ColumnCodec>
): Record<string, unknown> {
  if (feature("DEBUG_TRACING")) traceBegin("schema.flattenPatch");
  const row: Record<string, unknown> = {};
  const hasCodecs = codecs?.size;
  for (const col of meta.insertColumns) {
    if (!(col.name in obj) && !col.path) continue;
    let v: unknown;
    if (col.path) {
      v = getValueAtPath(obj, col.path);
    } else {
      v = obj[col.name];
    }
    if (v === undefined) continue;
    const encoded = encodeValue(v, col.sqlType);
    if (hasCodecs) {
      const codec = codecs!.get(col.name);
      row[col.name] = codec ? codec.encode(encoded) : encoded;
    } else {
      row[col.name] = encoded;
    }
  }
  if (feature("DEBUG_TRACING")) traceEnd();
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
  if (feature("DEBUG_TRACING")) traceBegin("schema.flattenSubRows");
  try {
    if (sub.isScalar) {
      const result: Array<Record<string, unknown>> = new Array(items.length);
      for (let idx = 0; idx < items.length; idx++) {
        const v = items[idx];
        result[idx] = {
          _owner_id: ownerPk,
          _index: idx,
          _value: encodeValue(v, sub.scalarType),
        };
      }
      return result;
    }
    const result: Array<Record<string, unknown>> = new Array(items.length);
    const hasCodecs = codecs?.size;
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (item === null || typeof item !== "object") {
        throw new TypeError("Sub-table item must be an object");
      }
      const obj = asRecord(item);
      const row: Record<string, unknown> = {
        _owner_id: ownerPk,
        _index: idx,
      };
      for (const col of sub.columns) {
        const v = col.path ? getValueAtPath(obj, col.path) : obj[col.name];
        const encoded = encodeValue(v, col.sqlType);
        if (hasCodecs) {
          const codec = codecs!.get(col.name);
          row[col.name] = codec ? codec.encode(encoded) : encoded;
        } else {
          row[col.name] = encoded;
        }
      }
      result[idx] = row;
    }
    return result;
  } finally { if (feature("DEBUG_TRACING")) traceEnd(); }
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
function decodeValue(
  v: unknown,
  sqlType: SqliteType,
  isBoolean?: boolean
): unknown {
  if (sqlType === "TEXT" && typeof v === "string") {
    const first = v.charCodeAt(0);
    // Only attempt JSON.parse for objects/arrays (starts with { or [)
    if (first === 123 || first === 91) {
      try {
        const parsed = JSON.parse(v);
        return typeof parsed === "object" ? parsed : v;
      } catch {
        return v;
      }
    }
    return v;
  }
  if (sqlType === "INTEGER" && typeof v === "number") {
    return isBoolean ? v === 1 : v;
  }
  return v ?? null;
}

/** Fast path: hydrate with no select filtering, no codecs, no subTables */
function hydrateRowFast(
  flat: Record<string, unknown>,
  meta: TableMeta
): Record<string, unknown> {
  if (feature("DEBUG_TRACING")) traceBegin("schema.hydrateRowFast");
  const obj: Record<string, unknown> = {};
  for (const col of meta.columns) {
    const v = decodeValue(flat[col.name], col.sqlType, col.isBoolean);
    if (col.path) {
      if (col.path.length === 1) {
        obj[col.path[0]!] = v;
      } else {
        setValueAtPath(obj, col.path, v);
      }
    } else {
      obj[col.name] = v;
    }
  }
  if (feature("DEBUG_TRACING")) traceEnd();
  return obj;
}

function hydrateRowCodec(
  flat: Record<string, unknown>,
  meta: TableMeta,
  codecs: Map<string, ColumnCodec>,
): Record<string, unknown> {
  if (feature("DEBUG_TRACING")) traceBegin("schema.hydrateRowCodec");
  const obj: Record<string, unknown> = {};
  for (const col of meta.columns) {
    let v: DBValue = flat[col.name] as DBValue;
    const codec = codecs.get(col.name);
    if (codec) v = codec.decode(v);
    const decoded = decodeValue(v, col.sqlType, col.isBoolean);
    if (col.path) {
      if (col.path.length === 1) {
        obj[col.path[0]!] = decoded;
      } else {
        setValueAtPath(obj, col.path, decoded);
      }
    } else {
      obj[col.name] = decoded;
    }
  }
  if (feature("DEBUG_TRACING")) traceEnd();
  return obj;
}

export function hydrateRow(
  flat: Record<string, unknown>,
  meta: TableMeta,
  subRows: Map<string, Record<string, unknown>[]>,
  codecs?: Map<string, ColumnCodec>,
  select?: string[],
  include?: string[]
): Record<string, unknown> {
  if (feature("DEBUG_TRACING")) traceBegin("schema.hydrateRow");
  // Fast path: no codecs, no select, no subTables
  if (!codecs?.size && !select && !meta.subTables.length) {
    if (feature("DEBUG_TRACING")) traceEnd();
    return hydrateRowFast(flat, meta);
  }

  const hasCodecs = codecs?.size;
  const obj: Record<string, unknown> = {};

  if (!select) {
    if (!hasCodecs) {
      hydrateRowFastOutput(flat, meta, obj);
    } else {
      hydrateRowCodecOutput(flat, meta, codecs!, obj);
    }
  } else {
    const selectedSet = new Set<string>();
    for (const s of select) {
      selectedSet.add(s);
      if (!s.includes(".")) {
        for (const col of meta.columns) {
          if (col.path && col.path[0] === s) selectedSet.add(col.name);
        }
      } else {
        const col = meta.columnByPath.get(s);
        if (col) selectedSet.add(col.name);
      }
    }

    for (const col of meta.columns) {
      if (!selectedSet.has(col.name)) continue;
      let v: DBValue = flat[col.name] as DBValue;
      if (hasCodecs) {
        const codec = codecs!.get(col.name);
        if (codec) v = codec.decode(v);
      }
      const decoded = decodeValue(v, col.sqlType, col.isBoolean);
      if (col.path) {
        if (col.path.length === 1) {
          obj[col.path[0]!] = decoded;
        } else {
          setValueAtPath(obj, col.path, decoded);
        }
      } else {
        obj[col.name] = decoded;
      }
    }

    for (const key of Object.keys(flat)) {
      if (selectedSet.has(key)) continue;
      if (key.includes("__")) {
        const parts = key.split("__");
        let decoded = flat[key];
        if (typeof decoded === "string") {
          const first = decoded.charCodeAt(0);
          if (first === 123 || first === 91) {
            try {
              const parsed = JSON.parse(decoded);
              if (typeof parsed === "object") decoded = parsed;
            } catch { /* leave as string */ }
          }
        }
        setValueAtPath(obj, parts, decoded);
      }
    }
  }

  for (const sub of meta.subTables) {
    if (include && !include.includes(sub.fieldName)) {
      obj[sub.fieldName] = [];
    } else if (sub.isScalar) {
      const rows = subRows.get(sub.tableName) ?? [];
      obj[sub.fieldName] = rows.map(r => decodeValue(r._value, sub.scalarType));
    } else {
      obj[sub.fieldName] = subRows.get(sub.tableName) ?? [];
    }
  }

  if (feature("DEBUG_TRACING")) traceEnd();
  return obj;
}

function hydrateRowFastOutput(flat: Record<string, unknown>, meta: TableMeta, obj: Record<string, unknown>): void {
  for (const col of meta.columns) {
    const v = decodeValue(flat[col.name], col.sqlType, col.isBoolean);
    if (col.path) {
      if (col.path.length === 1) {
        obj[col.path[0]!] = v;
      } else {
        setValueAtPath(obj, col.path, v);
      }
    } else {
      obj[col.name] = v;
    }
  }
}

function hydrateRowCodecOutput(flat: Record<string, unknown>, meta: TableMeta, codecs: Map<string, ColumnCodec>, obj: Record<string, unknown>): void {
  for (const col of meta.columns) {
    let v: DBValue = flat[col.name] as DBValue;
    const codec = codecs.get(col.name);
    if (codec) v = codec.decode(v);
    const decoded = decodeValue(v, col.sqlType, col.isBoolean);
    if (col.path) {
      if (col.path.length === 1) {
        obj[col.path[0]!] = decoded;
      } else {
        setValueAtPath(obj, col.path, decoded);
      }
    } else {
      obj[col.name] = decoded;
    }
  }
}
