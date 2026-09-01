/**
 * foxdb/src/migrate.ts
 * Migration runner - scans directory, filters unapplied migrations, runs them
 * in order inside a transaction, and records them in _foxdb_migrations.
 */

import { readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BunDatabase } from "./database.ts";
import type { Migration, MigrateOptions } from "./types.ts";

// --- Migration tracking table -------------------------------------------------

function ensureMigrationsTable(db: BunDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "_foxdb_migrations" (
      "name" TEXT PRIMARY KEY,
      "appliedAt" INTEGER NOT NULL
    )
  `);
}

function getAppliedMigrations(db: BunDatabase): Set<string> {
  const stmt = db.prepare('SELECT "name" FROM "_foxdb_migrations"');
  const rows = stmt.all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function recordMigration(db: BunDatabase, name: string): void {
  const stmt = db.prepare(
    'INSERT INTO "_foxdb_migrations" ("name", "appliedAt") VALUES (?, ?)'
  );
  stmt.run(name, Date.now());
}

// --- Discovery ----------------------------------------------------------------

function discoverMigrations(migrationsDir: string): Array<{ name: string; path: string }> {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const entries = readdirSync(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => ({
      name: e.name.slice(0, -3), // strip .ts
      path: resolve(join(migrationsDir, e.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return files;
}

// --- Public API ---------------------------------------------------------------

export async function migrate(opts: MigrateOptions): Promise<void> {
  const db = new BunDatabase({ path: opts.path });

  try {
    ensureMigrationsTable(db);
    const applied = getAppliedMigrations(db);
    const discovered = discoverMigrations(opts.migrationsDir);
    const pending = discovered.filter((d) => !applied.has(d.name));

    if (pending.length === 0) {
      return;
    }

    for (const mig of pending) {
      if (opts.target && mig.name > opts.target) {
        break;
      }

      const mod = (await import(mig.path)) as { default?: Migration };
      const migration = mod.default;

      if (!migration) {
        throw new Error(`foxdb migrate: file "${mig.path}" does not export a default Migration`);
      }

      if (typeof migration.up !== "function") {
        throw new Error(`foxdb migrate: migration "${migration.name}" is missing an up() function`);
      }

      db.transaction(() => {
        migration.up(db);
        recordMigration(db, mig.name);
      });
    }
  } finally {
    db.close();
  }
}
