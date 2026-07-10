/**
 * foxdb/src/fts.ts
 * SQLite FTS5 external-content full-text search: name/column resolution,
 * DDL, and in-transaction sync SQL builders.
 */
import { ColDecode, type TableMeta } from "./schema.ts";
import type { FTSConfig } from "./types.ts";
import { raise } from "./errors.ts";

export function ftsTableName(tableName: string): string {
  return `_foxdb_fts_${tableName}`;
}

export function resolveFtsColumns(meta: TableMeta, fts: FTSConfig): string[] {
  if (fts === true || (typeof fts === "object" && !fts.columns)) {
    const cols = meta.columns
      .filter((c) => !c.generated && c.sqlType === "TEXT" && (c.decode ?? ColDecode.Scalar) === ColDecode.Scalar && c.name !== meta.primaryKey)
      .map((c) => c.name);
    if (cols.length === 0) {
      raise("FTS_NO_TEXT_COLUMNS", `foxdb: table "${meta.tableName}" has fts enabled but no TEXT columns to index`, { table: meta.tableName });
    }
    return cols;
  }
  const names = fts.columns!.map((c) => c.name);
  for (const n of names) {
    if (!meta.columnByName.has(n)) {
      raise("FTS_INVALID_COLUMN", `foxdb: fts column "${n}" not found in table "${meta.tableName}"`, { table: meta.tableName, column: n });
    }
  }
  return names;
}

export function buildCreateFtsSQL(
  tableName: string,
  columns: string[],
  opts: { tokenizer?: string; prefix?: number[] }
): string {
  const ft = ftsTableName(tableName);
  const colDefs = columns.map((c) => `"${c}"`).join(", ");
  const parts = [colDefs, `content='${tableName}'`, `content_rowid='rowid'`];
  if (opts.tokenizer) parts.push(`tokenize='${opts.tokenizer.replace(/'/g, "''")}'`);
  if (opts.prefix && opts.prefix.length > 0) parts.push(`prefix='${opts.prefix.join(" ")}'`);
  return `CREATE VIRTUAL TABLE IF NOT EXISTS "${ft}" USING fts5(${parts.join(", ")})`;
}

export function buildFtsIndexInsert(
  tableName: string,
  pk: string,
  columns: string[],
  count: number,
  key: "pk" | "rowid" = "pk"
): { sql: string; placeholders: number } {
  const ft = ftsTableName(tableName);
  const cols = ["rowid", ...columns].map((c) => `"${c}"`).join(", ");
  const where = key === "rowid" ? `"rowid"` : `"${pk}"`;
  const ph = new Array(count).fill("?").join(", ");
  return {
    sql: `INSERT INTO "${ft}"(${cols}) SELECT ${cols} FROM "${tableName}" WHERE ${where} IN (${ph})`,
    placeholders: count,
  };
}

export function buildFtsDeleteCommand(
  tableName: string,
  pk: string,
  columns: string[],
  count: number,
  key: "pk" | "rowid" = "pk"
): { sql: string; placeholders: number } {
  const ft = ftsTableName(tableName);
  const colList = [`"${ft}"`, `"rowid"`, ...columns.map((c) => `"${c}"`)].join(", ");
  const selList = [`'delete'`, `"rowid"`, ...columns.map((c) => `"${c}"`)].join(", ");
  const where = key === "rowid" ? `"rowid"` : `"${pk}"`;
  const ph = new Array(count).fill("?").join(", ");
  return {
    sql: `INSERT INTO "${ft}"(${colList}) SELECT ${selList} FROM "${tableName}" WHERE ${where} IN (${ph})`,
    placeholders: count,
  };
}

export function buildFtsDeleteAllSQL(tableName: string): string {
  const ft = ftsTableName(tableName);
  return `INSERT INTO "${ft}"("${ft}") VALUES('delete-all')`;
}

export function buildFtsRebuildSQL(tableName: string): string {
  const ft = ftsTableName(tableName);
  return `INSERT INTO "${ft}"("${ft}") VALUES('rebuild')`;
}
