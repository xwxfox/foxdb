/**
 * foxdb/src/batch-writer.ts
 * Async write queue that batches inserts for throughput.
 */

import type { BunDatabase, SQLQueryBindings } from "./database.ts";
import { buildInsertMany } from "./query-builder.ts";

export interface BatchWriterOptions {
  maxBuffer?: number;
  flushIntervalMs?: number;
}

export class BatchWriter<TInput, TRow extends Record<string, unknown>> {
  private buffer: TRow[] = [];
  private readonly maxBuffer: number;
  private readonly tableName: string;
  private readonly db: BunDatabase;
  private readonly prepare: (row: TInput) => TRow;
  private readonly onFlush?: (rows: TRow[]) => void;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    tableName: string,
    db: BunDatabase,
    opts: BatchWriterOptions | undefined = {},
    callbacks: { prepare: (row: TInput) => TRow; onFlush?: (rows: TRow[]) => void }
  ) {
    this.tableName = tableName;
    this.db = db;
    this.maxBuffer = opts.maxBuffer ?? 1000;
    this.prepare = callbacks.prepare;
    this.onFlush = callbacks.onFlush;
    if (opts.flushIntervalMs) {
      this.timer = setInterval(() => this.flush(), opts.flushIntervalMs);
    }
  }

  insert(row: TInput): void {
    const prepared = this.prepare(row);
    this.buffer.push(prepared);
    if (this.buffer.length >= this.maxBuffer) this.flush();
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    const rows = this.buffer.splice(0, this.buffer.length);
    this.db.transaction(() => {
      const batches = buildInsertMany(this.tableName, rows);
      for (const { sql, params } of batches) {
        this.db.prepare(sql).run(...params);
      }
    });
    this.onFlush?.(rows);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
  }
}
