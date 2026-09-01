/**
 * foxdb/src/sync.ts
 * Sync policy engine - applies safe changes and handles unsafe ones
 * according to the configured policy.
 */

import { BunDatabase } from "./database.ts";
import type { SchemaDiff, SchemaChange, SyncPolicy } from "./types.ts";
import type { DesiredTable } from "./diff.ts";

// --- Helpers ------------------------------------------------------------------

function findDesiredTable(desired: DesiredTable[], name: string): DesiredTable | undefined {
  return desired.find((d) => d.name === name);
}

function buildCreateTableSQL(dt: DesiredTable): string {
  const colDefs = dt.columns.map((c) => {
    const notNull = !c.nullable ? " NOT NULL" : "";
    const pk = c.name === dt.primaryKey ? " PRIMARY KEY" : "";
    return `  "${c.name}" ${c.sqlType}${pk}${notNull}`;
  });
  return `CREATE TABLE IF NOT EXISTS "${dt.name}" (\n${colDefs.join(",\n")}\n)`;
}

function buildAddColumnSQL(table: string, column: { name: string; sqlType: string; nullable: boolean }): string {
  const notNull = !column.nullable ? " NOT NULL" : "";
  return `ALTER TABLE "${table}" ADD COLUMN "${column.name}" ${column.sqlType}${notNull}`;
}

function buildCreateIndexSQL(table: string, index: { name: string; unique: number; columns: string[] }): string {
  const uniq = index.unique ? "UNIQUE " : "";
  const cols = index.columns.map((c) => `"${c}"`).join(", ");
  return `CREATE ${uniq}INDEX IF NOT EXISTS "${index.name}" ON "${table}" (${cols})`;
}

function rebuildTable(
  db: BunDatabase,
  dt: DesiredTable
): void {
  const tempName = `${dt.name}_foxdb_temp`;
  const colDefs = dt.columns.map((c) => {
    const notNull = !c.nullable ? " NOT NULL" : "";
    const pk = c.name === dt.primaryKey ? " PRIMARY KEY" : "";
    return `  "${c.name}" ${c.sqlType}${pk}${notNull}`;
  });

  db.transaction(() => {
    db.exec(`CREATE TABLE "${tempName}" (\n${colDefs.join(",\n")}\n)`);
    const colNames = dt.columns.map((c) => `"${c.name}"`).join(", ");
    db.exec(`INSERT INTO "${tempName}" (${colNames}) SELECT ${colNames} FROM "${dt.name}"`);
    db.exec(`DROP TABLE "${dt.name}"`);
    db.exec(`ALTER TABLE "${tempName}" RENAME TO "${dt.name}"`);
  });
}

function createSubTable(
  db: BunDatabase,
  desired: DesiredTable[],
  change: Extract<SchemaChange, { kind: "add-subtable" }>
): void {
  const ownerTable = change.table;
  const sub = change.subTable;
  const owner = findDesiredTable(desired, ownerTable);
  if (!owner) {
    throw new Error(`foxdb sync: cannot find owner table "${ownerTable}" for sub-table "${sub.tableName}"`);
  }

  const pkCol = owner.columns.find((c) => c.name === owner.primaryKey);
  const pkType = pkCol?.sqlType ?? "TEXT";

  const colDefs = [
    `  "_id" INTEGER PRIMARY KEY AUTOINCREMENT`,
    `  "_owner_id" ${pkType} NOT NULL`,
    `  "_index" INTEGER NOT NULL`,
    ...sub.columns.map((c) => {
      const notNull = !c.nullable ? " NOT NULL" : "";
      return `  "${c.name}" ${c.sqlType}${notNull}`;
    }),
  ];

  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS "${sub.tableName}" (\n${colDefs.join(",\n")}\n)`);
    db.exec(`CREATE INDEX IF NOT EXISTS "idx_${sub.tableName}__owner" ON "${sub.tableName}" ("_owner_id")`);
  });
}

// --- Apply safe changes -------------------------------------------------------

function applySafeChanges(diff: SchemaDiff, db: BunDatabase, desired: DesiredTable[]): void {
  for (const change of diff.safe) {
    switch (change.kind) {
      case "add-table": {
        const dt = findDesiredTable(desired, change.table);
        if (!dt) throw new Error(`foxdb sync: missing desired schema for table "${change.table}"`);
        db.exec(buildCreateTableSQL(dt));
        break;
      }
      case "add-subtable": {
        createSubTable(db, desired, change);
        break;
      }
      case "add-column": {
        if (!change.column.nullable) {
          throw new Error(`foxdb sync: cannot auto-apply required column "${change.column.name}" without default. Use a migration.`);
        }
        db.exec(buildAddColumnSQL(change.table, change.column));
        break;
      }
      case "add-index": {
        db.exec(buildCreateIndexSQL(change.table, change.index));
        break;
      }
      case "change-nullable": {
        if (!change.to) {
          throw new Error(`foxdb sync: cannot auto-apply nullable → NOT NULL change on "${change.table}.${change.column}". Use a migration.`);
        }
        const dt = findDesiredTable(desired, change.table);
        if (!dt) throw new Error(`foxdb sync: missing desired schema for table "${change.table}"`);
        rebuildTable(db, dt);
        break;
      }
      case "drop-index": {
        db.exec(`DROP INDEX IF EXISTS "${change.index.name}"`);
        break;
      }
    }
  }
}

// --- Policy handlers ----------------------------------------------------------

function handlePolicy(
  diff: SchemaDiff,
  db: BunDatabase,
  policy: SyncPolicy
): boolean {
  if (diff.unsafe.length === 0 && diff.safe.length === 0) return true;

  if (policy === "ignore") {
    return true;
  }

  if (policy === "warn") {
    if (diff.unsafe.length > 0) {
      console.warn(`[foxdb] ${diff.unsafe.length} unsafe schema change(s) detected:`);
      for (const c of diff.unsafe) {
        console.warn(`  - ${c.kind}: ${JSON.stringify(c)}`);
      }
    }
    return true;
  }

  if (policy === "error") {
    if (diff.unsafe.length > 0 || diff.safe.length > 0) {
      throw new Error(
        `foxdb sync: schema drift detected. Safe=${diff.safe.length}, Unsafe=${diff.unsafe.length}`
      );
    }
    return true;
  }

  if (policy === "auto") {
    return true; // caller will apply safe changes and then re-check unsafe
  }

  if (typeof policy === "function") {
    const result = policy(diff, db);
    return result !== false;
  }

  return true;
}

// --- Public API ---------------------------------------------------------------

/** @category Migration */
export function applySync(
  diff: SchemaDiff,
  db: BunDatabase,
  policy: SyncPolicy,
  desired: DesiredTable[]
): void {
  if (diff.safe.length === 0 && diff.unsafe.length === 0) return;

  const shouldContinue = handlePolicy(diff, db, policy);
  if (!shouldContinue) return;

  if (policy === "auto") {
    applySafeChanges(diff, db, desired);

    if (diff.unsafe.length > 0) {
      throw new Error(
        `foxdb sync: ${diff.unsafe.length} unsafe change(s) cannot be auto-applied. Use migrations.\n` +
        diff.unsafe.map((c) => `  - ${c.kind}: ${JSON.stringify(c)}`).join("\n")
      );
    }
    return;
  }

  if (policy === "ignore") {
    return;
  }

  if (policy === "warn" || policy === "error") {
    // error already thrown above; warn just warns
    // We don't auto-apply safe changes in warn/error mode unless there are no unsafe changes
    if (diff.unsafe.length === 0) {
      applySafeChanges(diff, db, desired);
    }
    return;
  }

  if (typeof policy === "function") {
    // For custom policy, apply safe changes if the callback didn't block
    if (diff.unsafe.length === 0) {
      applySafeChanges(diff, db, desired);
    }
    return;
  }
}
