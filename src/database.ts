/**
 * foxdb/src/database.ts
 * Database connection manager - WAL mode, pragma tuning, migration/sync,
 * and the prepared-statement cache.
 */

import { Database, constants, type SQLQueryBindings } from "bun:sqlite";
import { TableScheduler } from "./scheduler.ts";

// ─── Typed statement wrapper ──────────────────────────────────────────────────

/** Narrow re-export so callers don't need to import bun:sqlite themselves */
export type { SQLQueryBindings };

/**
 * prepared sqlite statement
 * @category Database
 */
export interface BunStatement {
  run(...params: SQLQueryBindings[]): { changes: number; lastInsertRowid: number | bigint };
  all(...params: SQLQueryBindings[]): unknown[];
  get(...params: SQLQueryBindings[]): unknown;
  iterate(...params: SQLQueryBindings[]): IterableIterator<unknown>;
  finalize(): void;
}

// ─── Pragma defaults ──────────────────────────────────────────────────────────

/** @category Database */
export interface DatabaseOptions {
  /** Path to the SQLite file. Defaults to ":memory:" */
  path?: string;
  /**
   * Cache size in pages (each page is typically 4 KB).
   * Negative value = kilobytes. Defaults to -64000 (~64 MB).
   */
  cacheSize?: number;
  /**
   * Busy timeout in milliseconds while waiting for a write lock.
   * Defaults to 5000.
   */
  busyTimeout?: number;
  /**
   * PRAGMA synchronous level.
   * "OFF" | "NORMAL" | "FULL" | "EXTRA". Defaults to "NORMAL".
   * NORMAL is safe with WAL and gives the best perf/safety trade-off.
   */
  synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
  /** PRAGMA mmap_size in bytes. 0 disables. Defaults to 256 MB. */
  mmapSize?: number;
  /** PRAGMA auto_vacuum level. "incremental" | "full" | false. Defaults to false. */
  autoVacuum?: "incremental" | "full" | false;
}

// ─── foxdb Database ──────────────────────────────────────────────────────────

/**
 * sqlite database with statement caching and pragma tuning
 * @category Database
 */
export class BunDatabase {
  /** underlying bun:sqlite database */
  readonly db: Database;

  /** scheduler for table maintenance tasks */
  readonly scheduler = new TableScheduler();

  constructor(opts: DatabaseOptions = {}) {
    const path = opts.path ?? ":memory:";
    this.db = new Database(path, { create: true });

    // WAL mode - must be set before anything else
    this.db.run("PRAGMA journal_mode = WAL;");

    // Performance + safety pragmas
    const sync = opts.synchronous ?? "NORMAL";
    const cache = opts.cacheSize ?? -64000;
    const busy = opts.busyTimeout ?? 5000;
    const mmap = opts.mmapSize ?? 268435456; // 256 MB

    this.db.run(`PRAGMA synchronous = ${sync};`);
    this.db.run(`PRAGMA cache_size = ${cache};`);
    this.db.run(`PRAGMA busy_timeout = ${busy};`);
    this.db.run(`PRAGMA mmap_size = ${mmap};`);
    this.db.run("PRAGMA foreign_keys = ON;");
    this.db.run("PRAGMA temp_store = MEMORY;");

    const autoVacuum = opts.autoVacuum ?? false;
    if (autoVacuum) {
      this.db.run(`PRAGMA auto_vacuum = ${autoVacuum.toUpperCase()};`);
    }
  }

  /** execute ddl (create table, index, etc) */
  exec(sql: string): void {
    this.db.run(sql);
  }

  /** run a block inside a transaction */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** close the database and finalize cached statements */
  close(): void {
    this.scheduler.clearAll();
    // Finalize all cached statements before closing the DB
    for (const stmt of this._stmtCache.values()) {
      try { stmt.finalize(); } catch { /* already finalized */ }
    }
    this._stmtCache.clear();

    try {
      this.db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
      this.db.run("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // Best-effort - ignore if already closed or in-memory
    }
    this.db.close();
  }

  private static readonly _MAX_CACHE_SIZE = 256;
  private readonly _stmtCache = new Map<string, BunStatement>();

  /** get or compile a prepared statement */
  prepare(sql: string): BunStatement {
    let stmt = this._stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      // Evict oldest entry if at capacity (Map preserves insertion order)
      if (this._stmtCache.size >= BunDatabase._MAX_CACHE_SIZE) {
        const firstKey = this._stmtCache.keys().next().value;
        if (firstKey !== undefined) {
          const old = this._stmtCache.get(firstKey);
          try { old?.finalize(); } catch { /* ignore */ }
          this._stmtCache.delete(firstKey);
        }
      }
      this._stmtCache.set(sql, stmt);
    }
    return stmt as BunStatement;
  }

  /** set synchronous pragma for bulk load or normal operation */
  setSynchronous(mode: "OFF" | "NORMAL" | "FULL" | "EXTRA"): void {
    this.db.run(`PRAGMA synchronous = ${mode};`);
  }

  /** clear the statement cache */
  clearCache(): void {
    for (const stmt of this._stmtCache.values()) {
      try { stmt.finalize(); } catch { /* ignore */ }
    }
    this._stmtCache.clear();
  }
}

import { existsSync, unlinkSync } from "node:fs";

export function resolveDbFilePaths(path: string): string[] {
  if (path === ":memory:") return [];
  return [
    path,
    `${path}-wal`,
    `${path}-shm`,
    `${path}-journal`,
  ].filter((p) => existsSync(p));
}

export function unlinkDbFiles(path: string): void {
  for (const p of resolveDbFilePaths(path)) {
    try {
      unlinkSync(p);
    } catch {
      // best-effort
    }
  }
}