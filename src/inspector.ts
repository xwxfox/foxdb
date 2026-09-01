/**
 * foxdb/src/inspector.ts
 * Schema inspector - reads actual SQLite schema via PRAGMA and sqlite_master.
 */

import { BunDatabase } from "./database.ts";

// --- Types --------------------------------------------------------------------

/** @category Advanced */
export interface InspectorColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/** @category Advanced */
export interface InspectorIndex {
  name: string;
  unique: number;
  columns: string[];
}

/** @category Advanced */
export interface InspectorTable {
  name: string;
  columns: InspectorColumn[];
  indexes: InspectorIndex[];
}

// --- Helpers ------------------------------------------------------------------

function listUserTables(db: BunDatabase): string[] {
  const stmt = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_foxdb_%' ORDER BY name`
  );
  const rows = stmt.all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function listIndexesForTable(db: BunDatabase, tableName: string): Array<{ name: string; unique: number }> {
  const stmt = db.prepare(
    `SELECT name, "unique" AS "unique" FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'sqlite_autoindex_%'`
  );
  const rows = stmt.all(tableName) as Array<{ name: string; unique: number }>;
  return rows;
}

function getIndexColumns(db: BunDatabase, indexName: string): string[] {
  const stmt = db.prepare(`PRAGMA index_info("${indexName}")`);
  const rows = stmt.all() as Array<{ name: string | null }>;
  return rows.map((r) => r.name).filter((n): n is string => n != null);
}

// --- Public API ---------------------------------------------------------------

/** @category Advanced */
export function inspectSchema(db: BunDatabase, tableName: string): InspectorTable {
  const stmt = db.prepare(`PRAGMA table_info("${tableName}")`);
  const columns = stmt.all() as InspectorColumn[];

  const indexes: InspectorIndex[] = [];
  for (const idx of listIndexesForTable(db, tableName)) {
    const colNames = getIndexColumns(db, idx.name);
    indexes.push({
      name: idx.name,
      unique: idx.unique,
      columns: colNames,
    });
  }

  return { name: tableName, columns, indexes };
}

/** @category Advanced */
export function inspectAllTables(db: BunDatabase): InspectorTable[] {
  const tables = listUserTables(db);
  return tables.map((t) => inspectSchema(db, t));
}
