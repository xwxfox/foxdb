/**
 * foxdb/src/diff.ts
 * Schema diff engine - compares desired schema with actual SQLite schema.
 */

import type { ColumnMeta } from "./schema.ts";
import type { InspectorTable, InspectorColumn, InspectorIndex } from "./inspector.ts";
import type { SchemaDiff, SchemaChange } from "./types.ts";

// --- Input types --------------------------------------------------------------

export interface DesiredTable {
  name: string;
  columns: ColumnMeta[];
  indexes: Array<{ name?: string; columns: string[]; unique?: boolean }>;
  primaryKey: string;
}

// --- Helpers ------------------------------------------------------------------

function normalizeType(t: string): string {
  return t.toUpperCase().trim();
}

/** SQLite type affinity - treats VARCHAR, CHAR, CLOB as TEXT, etc. */
function affinityType(t: string): string {
  const upper = normalizeType(t);
  if (upper.includes("INT")) return "INTEGER";
  if (upper.includes("CHAR") || upper.includes("CLOB") || upper.includes("TEXT")) return "TEXT";
  if (upper.includes("BLOB")) return "BLOB";
  if (upper.includes("REAL") || upper.includes("FLOA") || upper.includes("DOUB")) return "REAL";
  return "NUMERIC";
}

function isInternalColumn(name: string): boolean {
  return name === "_id" || name === "_owner_id" || name === "_index";
}

function findColumn(actual: InspectorTable, name: string): InspectorColumn | undefined {
  return actual.columns.find((c) => c.name === name);
}

function findIndex(actual: InspectorTable, columns: string[], unique: boolean): InspectorIndex | undefined {
  const sortedDesired = [...columns].sort().join(",");
  return actual.indexes.find((idx) => {
    if (Boolean(idx.unique) !== unique) return false;
    const sortedActual = [...idx.columns].sort().join(",");
    return sortedActual === sortedDesired;
  });
}

/** Extract composite PK columns ordered by their position in the PK */
function getActualPkColumns(actual: InspectorTable): string[] {
  return actual.columns
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
}

// --- Diff logic ---------------------------------------------------------------

/** @category Migration */
export function computeDiff(desired: DesiredTable[], actual: InspectorTable[]): SchemaDiff {
  const safe: SchemaChange[] = [];
  const unsafe: SchemaChange[] = [];

  const actualByName = new Map(actual.map((t) => [t.name, t]));

  for (const dt of desired) {
    const at = actualByName.get(dt.name);

    if (!at) {
      // Table doesn't exist yet
      if (dt.name.includes("__")) {
        safe.push({
          kind: "add-subtable", table: dt.name.split("__")[0]!, subTable: {
            fieldName: dt.name.split("__")[1]!,
            tableName: dt.name,
            columns: dt.columns.map((c) => ({ name: c.name, sqlType: c.sqlType, nullable: c.nullable, optional: c.optional })),
          }
        });
      } else {
        safe.push({ kind: "add-table", table: dt.name });
      }
      continue;
    }

    // Compare columns
    for (const dc of dt.columns) {
      const ac = findColumn(at, dc.name);
      if (!ac) {
        // New column
        if (dc.nullable) {
          safe.push({
            kind: "add-column", table: dt.name, column: {
              name: dc.name,
              sqlType: dc.sqlType,
              nullable: dc.nullable,
              optional: dc.optional,
            }, hasDefault: false
          });
        } else {
          unsafe.push({
            kind: "add-column", table: dt.name, column: {
              name: dc.name,
              sqlType: dc.sqlType,
              nullable: dc.nullable,
              optional: dc.optional,
            }, hasDefault: false
          });
        }
        continue;
      }

      // Type mismatch (using SQLite affinity for comparison)
      if (affinityType(dc.sqlType) !== affinityType(ac.type)) {
        unsafe.push({ kind: "change-type", table: dt.name, column: dc.name, from: ac.type, to: dc.sqlType });
      }

      // Nullable mismatch
      const desiredNotNull = !dc.nullable;
      const actualNotNull = ac.notnull === 1;
      if (desiredNotNull !== actualNotNull) {
        if (actualNotNull && !desiredNotNull) {
          // not null → nullable: safe
          safe.push({ kind: "change-nullable", table: dt.name, column: dc.name, to: true });
        } else {
          // nullable → not null: unsafe
          unsafe.push({ kind: "change-nullable", table: dt.name, column: dc.name, to: false });
        }
      }
    }

    // Columns in actual but not desired
    for (const ac of at.columns) {
      if (isInternalColumn(ac.name)) continue;
      if (!dt.columns.find((c) => c.name === ac.name)) {
        unsafe.push({ kind: "drop-column", table: dt.name, column: ac.name });
      }
    }

    // PK mismatch (supports composite PKs)
    const actualPkCols = getActualPkColumns(at);
    const desiredPkCols = dt.primaryKey.split(",").map((c) => c.trim());
    if (actualPkCols.length !== desiredPkCols.length || !actualPkCols.every((c, i) => c === desiredPkCols[i])) {
      unsafe.push({ kind: "change-pk", table: dt.name });
    }

    // Compare indexes (ignore SQLite internal / auto indexes)
    const actualUserIndexes = at.indexes.filter((idx) => !idx.name.startsWith("sqlite_") && !idx.name.startsWith("idx_sqlite_"));
    for (const di of dt.indexes) {
      if (!findIndex(at, di.columns, di.unique ?? false)) {
        safe.push({
          kind: "add-index", table: dt.name, index: {
            name: di.name ?? `idx_${dt.name}__${di.columns.join("_")}`,
            unique: di.unique ? 1 : 0,
            columns: di.columns,
          }
        });
      }
    }

    // Indexes in actual but not desired
    for (const ai of actualUserIndexes) {
      const stillNeeded = dt.indexes.some((di) => {
        const sortedDesired = [...di.columns].sort().join(",");
        const sortedActual = [...ai.columns].sort().join(",");
        return sortedDesired === sortedActual && Boolean(di.unique) === Boolean(ai.unique);
      });
      if (!stillNeeded) {
        unsafe.push({ kind: "drop-index", table: dt.name, index: { name: ai.name, unique: ai.unique, columns: ai.columns } });
      }
    }
  }

  // Tables in actual but not desired
  const desiredNames = new Set(desired.map((d) => d.name));
  for (const at of actual) {
    if (!desiredNames.has(at.name)) {
      unsafe.push({ kind: "drop-table", table: at.name });
    }
  }

  return { safe, unsafe };
}
