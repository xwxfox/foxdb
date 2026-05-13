/**
 * foxdb/src/repository.ts
 * Typed repository for a single table - insert, find, update, delete,
 * upsert, paginate, count, and sub-table hydration.
 * Zero runtime casts; all types are inferred from the TObject schema.
 */

import { Compile } from "typebox/compile";
import type { TObject, TProperties, TSchema } from "typebox";
import type {
  Infer,
  ScalarKeys,
  SubTableKeys,
  SubTableItem,
  FindOptions,
  InsertData,
  UpdateData,
  UpdateWhereOptions,
  UpsertOptions,
  UpsertManyOptions,
  PageResult,
  WhereClause,
  OrderByClause,
  TableConfig,
  Entity,
  ProjectedEntity,
  TableOperation,
  BroadOperation,
  AggregateOptions,
  AggregateResult,
  AggregationOp,
  WindowQueryOptions,
  WindowResult,
  Cursor,
  CursorInput,
  CursorPageResult,
  QueryMetrics,
  SelectableKeys,
  SelectShape,
  GeneratedColumnConfig,
} from "./types.ts";
import type { BunDatabase, SQLQueryBindings } from "./database.ts";
import { QueryExecutor } from "./query-executor.ts";
import type { EventBus } from "./events.ts";
import { withTrace, raise, enterTrace, leaveTrace } from "./errors.ts";
import {
  introspectTable,
  buildCreateTableSQL,
  buildIndexSQL,
  flattenRow,
  flattenPatch,
  flattenSubRows,
  hydrateRow,
  convertGeneratedConfig,
  type TableMeta,
  type SqliteScalar,
} from "./schema.ts";
import { GzipCodec } from "./codec.ts";
import type { ColumnCodec } from "./codec.ts";
import {
  buildSelect,
  buildSelectSql,
  buildInsert,
  buildInsertMany,
  buildUpsert,
  buildUpsertMany,
  buildUpdate,
  buildUpdateWhere,
  buildDelete,
  buildWhere,
  resolveOrderByColumn,
} from "./query-builder.ts";
import { buildAggregateSql } from "./aggregate.ts";
import { buildWindowSql } from "./window.ts";
import { BatchWriter, type BatchWriterOptions } from "./batch-writer.ts";
import { resolveTimestampNames } from "./timestamps.ts";
import type { TimestampConfig } from "./timestamps.ts";

// ─── Repository ───────────────────────────────────────────────────────────────

/**
 * Typed repository for a single table. Every entry in your `tables` config
 * becomes one of these on the ORM object, fully typed to its schema.
 *
 * @category Repositories
 *
 * @example
 * ```ts
 * const orm = createORM({
 *   tables: {
 *     users: table(UserSchema, (s) => ({ primaryKey: s.id })),
 *   },
 * });
 *
 * // All methods are fully typed - wrong property names are caught at compile time
 * orm.users.insert({ id: "u1", name: "alice", email: "a@x.com" });
 * const user = orm.users.findById("u1");
 * orm.users.update({ id: "u1", name: "alice smith" });
 * orm.users.deleteById("u1");
 * ```
 */
export class Repository<
  TWrite extends TSchema & { properties: Record<string, TSchema> },
  TQuery extends TSchema & { properties: Record<string, TSchema> },
  PK extends ScalarKeys<TWrite>,
  Mat = never,
  TS = {}
> {
  readonly tableName: string;
  /** table metadata - columns, sub-tables, indexes */
  readonly meta: TableMeta;

  private readonly validator: ReturnType<typeof Compile<TWrite>>;
  private readonly db: BunDatabase;
  private readonly descriptor: TableConfig<
    TWrite,
    PK & string,
    import("./types.ts").TimestampConfig,
    GeneratedColumnConfig | undefined
  >;
  private _entityProto: object | null = null;
  private readonly _timestampNames: { createdAt: string | null; updatedAt: string | null };
  private _materialize?: (
    record: Record<string, unknown>
  ) => Record<string, unknown>;
  private _materializeMany?: (
    records: Record<string, unknown>[]
  ) => Record<string, unknown>[];
  private _events?: EventBus;
  private _executor: QueryExecutor;
  private readonly _codecs: Map<string, ColumnCodec>;

  /** @internal */
  setEventBus(bus: EventBus): void {
    this._events = bus;
  }

  /** @internal */
  setMetricsHook(hook?: (meta: QueryMetrics) => void): void {
    this._executor = new QueryExecutor({ db: this.db, tableName: this.tableName, metricsHook: hook });
  }

  constructor(
    tableName: string,
    config: TableConfig<
      TWrite,
      PK & string,
      import("./types.ts").TimestampConfig,
      GeneratedColumnConfig | undefined
    >,
    db: BunDatabase
  ) {
    this.tableName = tableName;
    this.descriptor = config;
    this.db = db;
    this._executor = new QueryExecutor({ db, tableName: this.tableName });
    this.meta = introspectTable(
      tableName,
      config.schema,
      convertGeneratedConfig(config.generated),
    );
    this._timestampNames = resolveTimestampNames(config.timestamps, this.meta);
    this.validator = Compile(config.schema);

    const codecs = new Map<string, ColumnCodec>();
    if (config.compression?.algorithm === "gzip") {
      for (const colRef of config.compression.columns) {
        codecs.set(colRef.name, GzipCodec);
      }
    }
    this._codecs = codecs;

    // Override DDL type for compressed columns to BLOB
    for (const col of this.meta.columns) {
      if (this._codecs.has(col.name)) {
        col.sqlType = "BLOB";
      }
    }

    this._migrate();

    if (config.eviction) {
      db.scheduler.schedule(`evict:${tableName}`, 30000, () => this._runEviction());
      if (config.eviction.maxRows && !config.eviction.lruColumn) {
        console.warn(`[foxdb] table "${tableName}" has eviction.maxRows without lruColumn. Eviction will use PK order, which is not true LRU.`);
      }
    }
  }

  /** Ensure PK is selected when include is requested */
  private _ensureSelectPk(opts: FindOptions<TQuery>): FindOptions<TQuery> {
    const pk = this.descriptor.primaryKey.name;
    if (opts.select && opts.include && !opts.select.includes(pk)) {
      return { ...opts, select: [...opts.select, pk] };
    }
    return opts;
  }

  /**
   * Two-phase row fetch: first get PKs via index, then fetch full rows.
   * Avoids reading all columns for rows that don't match the WHERE clause.
   */
  private _fetchRows(
    opts: FindOptions<TQuery>,
    operation: string
  ): Record<string, unknown>[] {
    const pk = this.descriptor.primaryKey.name;
    const softDeleteCol = this.descriptor.softDelete?.column;

    // Two-phase is beneficial when:
    // 1. User didn't specify an explicit select (wants full objects)
    // 2. There IS a where clause (filtering is happening)
    // Falls back to single-phase if phase-1 returns >500 rows (SQLite param limit safety).
    const canTwoPhase =
      !opts.select &&
      opts.where &&
      Object.keys(opts.where).length > 0;

    if (!canTwoPhase) {
      const { sql, params } = buildSelect(
        this.tableName,
        opts,
        softDeleteCol,
        this.meta
      );
      return this._executor.all<Record<string, unknown>>(
        sql,
        params,
        operation
      );
    }

    // Phase 1: fetch only PKs (covers index-only scans)
    const pkOpts: FindOptions<TQuery> = {
      ...opts,
      select: [pk] as [PK],
      include: undefined,
    };
    const { sql: pkSql, params: pkParams } = buildSelect(
      this.tableName,
      pkOpts,
      softDeleteCol,
      this.meta
    );
    const pkRows = this._executor.all<Record<string, unknown>>(
      pkSql,
      pkParams,
      operation
    );
    const pkValues = pkRows
      .map((r: Record<string, unknown>) => r[pk])
      .filter((v: unknown): v is string | number => typeof v === "string" || typeof v === "number");

    if (pkValues.length === 0) return [];

    // SQLite host parameter limit is 999; fallback if we exceed a safe threshold
    if (pkValues.length > 500) {
      const { sql, params } = buildSelect(
        this.tableName,
        opts,
        softDeleteCol,
        this.meta
      );
      return this._executor.all<Record<string, unknown>>(
        sql,
        params,
        operation
      );
    }

    // Phase 2: fetch full rows for the matching PKs
    const ph = pkValues.map(() => "?").join(", ");
    const fullSql = `SELECT * FROM "${this.tableName}" WHERE "${pk}" IN (${ph})`;
    const rows = this._executor.all<Record<string, unknown>>(
      fullSql,
      pkValues,
      operation
    );

    // Preserve the ordering from phase 1 (orderBy / limit / offset already applied there)
    const pkOrder = new Map(pkValues.map((v, i) => [v, i]));
    rows.sort((a, b) => {
      const av = a[pk];
      const bv = b[pk];
      const ai = pkOrder.get(av as string | number) ?? 0;
      const bi = pkOrder.get(bv as string | number) ?? 0;
      return ai - bi;
    });

    return rows;
  }

  /** Inject materializers after ORM two-pass init */
  setMaterializer(
    single: (record: Record<string, unknown>) => Record<string, unknown>,
    many: (records: Record<string, unknown>[]) => Record<string, unknown>[]
  ): void {
    this._materialize = single;
    this._materializeMany = many;

    // Build shared entity prototype
    const proto = Object.create(null);
    Object.defineProperty(proto, "materialize", {
      value: function () {
        return single(this);
      },
      writable: false,
      enumerable: false,
      configurable: false,
    });
    this._entityProto = proto;
  }

  /** Wrap raw data in an entity object */
  private _wrap(data: Record<string, unknown>): Entity<Infer<TQuery>, Mat, TS> {
    if (!this._entityProto) return data as Entity<Infer<TQuery>, Mat, TS>;
    const entity = Object.create(this._entityProto);
    Object.assign(entity, data);
    return entity as Entity<Infer<TQuery>, Mat, TS>;
  }

  /** Narrow a parsed schema value to a plain record for dynamic property access */
  private _record(value: Infer<TWrite>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value));
  }

  /** Validate that a value is a valid SQLite scalar for use as a primary key */
  private _assertPk(val: unknown): SqliteScalar {
    if (
      val === null ||
      typeof val === "string" ||
      typeof val === "number" ||
      typeof val === "boolean" ||
      typeof val === "bigint"
    ) {
      return val;
    }
    raise("INSERT_INVALID_PK", `Primary key must be a scalar, got ${typeof val}`, {
      table: this.tableName,
    });
  }

  private _emit<Op extends TableOperation, D = Infer<TQuery> | Infer<TQuery>[] | Partial<Infer<TQuery>> | Record<string, unknown>, Result = Infer<TQuery> | Infer<TQuery>[] | PageResult<Infer<TQuery>> | number | null>(
    operation: Op,
    payload: {
      data?: D;
      result?: Result;
      id?: unknown;
      where?: unknown;
      options?: unknown;
    }
  ): void {
    if (!this._events) return;
    const ts = Date.now();
    const base = { table: this.tableName, operation, timestamp: ts };
    const full = { ...base, ...payload };

    const opKey = `${this.tableName}.${operation}`;
    if (this._events.has(opKey)) {
      this._events.emit(opKey, full);
    }

    // Broad category mapping
    let broad: BroadOperation | undefined;
    if (operation.startsWith("find") || operation === "count") broad = "read";
    else if (operation === "delete" || operation === "deleteWhere" || operation === "flush") broad = "delete";
    else broad = "write";

    const broadKey = `${this.tableName}.${broad}`;
    if (this._events.has(broadKey)) {
      this._events.emit(broadKey, { ...full, operation: broad });
    }
  }

  // ─── Migration ─────────────────────────────────────────────────────────────

  private _migrate(): void {
    const pk = this.descriptor.primaryKey.name;
    const stmts = buildCreateTableSQL(this.meta, pk);
    this.db.transaction(() => {
      for (const sql of stmts) this.db.exec(sql);

      for (const idx of this.descriptor.indexes ?? []) {
        this.db.exec(
          buildIndexSQL(
            this.tableName,
            idx.columns.map((c) => c.name),
            idx.unique ?? false,
            idx.name,
            idx.where,
            idx.include?.map((c) => c.name)
          )
        );
      }
    });
    this.db.clearCache();
  }

  // ─── Eviction ──────────────────────────────────────────────────────────────

  private _runEviction(): void {
    const ev = this.descriptor.eviction;
    if (!ev) return;
    const now = Date.now();

    if (ev.ttlColumn && ev.ttlMs) {
      const cutoff = now - ev.ttlMs;
      this._executor.exec(
        `DELETE FROM "${this.tableName}" WHERE "${ev.ttlColumn}" < ?`,
        [cutoff],
        "evict"
      );
    }

    if (ev.maxRows) {
      const orderCol = ev.lruColumn ?? this.descriptor.primaryKey.name;
      const countResult = this.db.prepare(`SELECT COUNT(*) as c FROM "${this.tableName}"`).get() as { c: number };
      const count = countResult.c;
      if (count <= ev.maxRows) return;
      const toDelete = count - ev.maxRows;
      this._executor.exec(
        `DELETE FROM "${this.tableName}" WHERE "${this.descriptor.primaryKey.name}" IN (
          SELECT "${this.descriptor.primaryKey.name}" FROM "${this.tableName}"
          ORDER BY "${orderCol}" ASC
          LIMIT ?
        )`,
        [toDelete],
        "evict"
      );
    }
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  /**
   * Validate and coerce data against the schema. Throws on invalid input.
   *
   * @group Validation
   *
   * @example
   * ```ts
   * const user = orm.users.parse({ id: "u1", name: "alice" });
   * // user is typed as Infer<typeof UserSchema>
   * ```
   */
  parse(data: unknown): Infer<TWrite> {
    return this.validator.Parse(data);
  }

  /**
   * Type-guard - returns true if data matches the schema.
   *
   * @group Validation
   *
   * @example
   * ```ts
   * if (orm.users.check(someData)) {
   *   // someData is now typed as Infer<typeof UserSchema>
   * }
   * ```
   */
  check(data: unknown): data is Infer<TWrite> {
    return this.validator.Check(data);
  }

  // ─── Insert ────────────────────────────────────────────────────────────────

  /**
   * Insert a single record. Returns the inserted entity.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * const user = orm.users.insert({
   *   id: "u1",
   *   name: "alice",
   *   email: "alice@example.com",
   * });
   * ```
   */
  insert(data: InsertData<TWrite>): Entity<Infer<TQuery>, Mat, TS> {
    return withTrace("repository.insert", { table: this.tableName }, () => {
      const parsed = this.parse(data);
      const obj = this._record(parsed);
      const now = Date.now();
      if (this._timestampNames.createdAt) obj[this._timestampNames.createdAt] = now;
      if (this._timestampNames.updatedAt) obj[this._timestampNames.updatedAt] = now;

      this.db.transaction(() => {
        // Main row
        const flat = flattenRow(obj, this.meta, this._codecs);
        const { sql, params } = buildInsert(this.tableName, flat);
        this._executor.exec(sql, params, "insert");

        const pkVal = obj[this.descriptor.primaryKey.name];

        // Sub-table rows
        for (const sub of this.meta.subTables) {
          const items = obj[sub.fieldName];
          if (!globalThis.Array.isArray(items) || items.length === 0) continue;
          const rows = flattenSubRows(this._assertPk(pkVal), items, sub, this._codecs);
          for (const row of rows) {
            const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
            this._executor.exec(iSql, iParams, "insert");
          }
        }
      });

      if (this.descriptor.eviction) {
        this._runEviction();
      }
      this._emit("insert", { data: obj });
      return this._wrap(obj);
    });
  }

  /**
   * Insert many records in a single transaction.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * orm.users.insertMany([
   *   { id: "u1", name: "alice", email: "a@x.com" },
   *   { id: "u2", name: "bob", email: "b@x.com" },
   * ]);
   * ```
   */
  insertMany(records: InsertData<TWrite>[]): Entity<Infer<TQuery>, Mat, TS>[] {
    return withTrace("repository.insertMany", { table: this.tableName }, () => {
      const parsed = records.map((r) => this.parse(r));
      const objs = parsed.map((p) => {
        const obj = this._record(p);
        const now = Date.now();
        if (this._timestampNames.createdAt) obj[this._timestampNames.createdAt] = now;
        if (this._timestampNames.updatedAt) obj[this._timestampNames.updatedAt] = now;
        return obj;
      });
      const flatRows = objs.map((obj) => flattenRow(obj, this.meta, this._codecs));

      this.db.transaction(() => {
        const batches = buildInsertMany(this.tableName, flatRows);
        for (const { sql, params } of batches) {
          this._executor.exec(sql, params, "insertMany");
        }
        // Sub-tables still insert individually per parent
        for (const obj of objs) {
          const pkVal = obj[this.descriptor.primaryKey.name];
          for (const sub of this.meta.subTables) {
            const items = obj[sub.fieldName];
            if (!globalThis.Array.isArray(items) || items.length === 0) continue;
            const rows = flattenSubRows(this._assertPk(pkVal), items, sub, this._codecs);
            for (const row of rows) {
              const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
              this._executor.exec(iSql, iParams, "insertMany");
            }
          }
        }
      });

      if (this.descriptor.eviction) {
        this._runEviction();
      }
      this._emit("insertMany", { data: objs });
      return objs.map((obj) => this._wrap(obj));
    });
  }

  /**
   * Create a batch writer for high-throughput insert streaming.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * const writer = orm.users.createBatchWriter({ maxBuffer: 500 });
   * writer.insert({ id: "u1", name: "alice" });
   * writer.close();
   * ```
   */
  createBatchWriter(opts?: BatchWriterOptions): BatchWriter<InsertData<TWrite>, Record<string, unknown>> {
    const self = this;
    return new BatchWriter(this.tableName, this.db, opts, {
      prepare(data: InsertData<TWrite>): Record<string, unknown> {
        const parsed = self.parse(data);
        const obj = self._record(parsed);
        const now = Date.now();
        if (self._timestampNames.createdAt) obj[self._timestampNames.createdAt] = now;
        if (self._timestampNames.updatedAt) obj[self._timestampNames.updatedAt] = now;
        return flattenRow(obj, self.meta, self._codecs);
      },
      onFlush(rows: Record<string, unknown>[]) {
        self._emit("insertMany", { data: rows });
        if (self.descriptor.eviction && Math.random() < 0.2) {
          self._runEviction();
        }
      },
    });
  }

  // ─── Upsert ────────────────────────────────────────────────────────────────

  /**
   * Insert or update on conflict. If the record exists (by conflict target),
   * it updates the specified columns instead.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * orm.users.upsert({
   *   data: { id: "u1", name: "alice", email: "new@x.com" },
   *   conflictTarget: "id",
   * });
   * ```
   */
  upsert(opts: UpsertOptions<TWrite, PK>): Entity<Infer<TQuery>, Mat, TS> {
    return withTrace("repository.upsert", { table: this.tableName }, () => {
      const parsed = this.parse(opts.data);
      const obj = this._record(parsed);
      const now = Date.now();
      if (this._timestampNames.createdAt) obj[this._timestampNames.createdAt] = now;
      if (this._timestampNames.updatedAt) obj[this._timestampNames.updatedAt] = now;
      const flat = flattenRow(obj, this.meta, this._codecs);

      const conflictCols: string[] = (
        globalThis.Array.isArray(opts.conflictTarget)
          ? opts.conflictTarget
          : [opts.conflictTarget]
      );

      const allCols = Object.keys(flat);
      const updateCols: string[] =
        opts.update ??
        allCols.filter((c) => !conflictCols.includes(c));

      // Reactivate soft-deleted rows on conflict
      if (this.descriptor.softDelete && !updateCols.includes(this.descriptor.softDelete.column)) {
        updateCols.push(this.descriptor.softDelete.column);
        flat[this.descriptor.softDelete.column] = null;
      }

      this.db.transaction(() => {
        const { sql, params } = buildUpsert(
          this.tableName,
          flat,
          conflictCols,
          updateCols
        );
        this._executor.exec(sql, params, "upsert");

        const pkVal = obj[this.descriptor.primaryKey.name];

        // Re-sync sub-tables: delete old rows, re-insert
        for (const sub of this.meta.subTables) {
          this._executor.exec(
            `DELETE FROM "${sub.tableName}" WHERE "_owner_id" = ?`,
            [pkVal as string | number],
            "delete"
          );

          const items = obj[sub.fieldName];
          if (!globalThis.Array.isArray(items) || items.length === 0) continue;
          const rows = flattenSubRows(this._assertPk(pkVal), items, sub, this._codecs);
          for (const row of rows) {
            const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
            this._executor.exec(iSql, iParams, "insert");
          }
        }
      });

      if (this.descriptor.eviction) {
        this._runEviction();
      }
      this._emit("upsert", { data: parsed });
      return this._wrap(this._record(parsed));
    });
  }

  /**
   * Bulk upsert with conflict resolution.
   * Sub-table rows are reconciled by deleting old rows and re-inserting.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * orm.users.upsertMany({
   *   data: [
   *     { id: "u1", name: "alice" },
   *     { id: "u2", name: "bob" },
   *   ],
   *   conflictTarget: "id",
   * });
   * ```
   */
  upsertMany(opts: UpsertManyOptions<TWrite, PK>): number {
    return withTrace("repository.upsertMany", { table: this.tableName }, () => {
      const parsed = opts.data.map((r) => this.parse(r));
      const objs = parsed.map((p) => {
        const obj = this._record(p);
        const now = Date.now();
        if (this._timestampNames.createdAt) obj[this._timestampNames.createdAt] = now;
        if (this._timestampNames.updatedAt) obj[this._timestampNames.updatedAt] = now;
        return obj;
      });
      const flatRows = objs.map((obj) => flattenRow(obj, this.meta, this._codecs));

      const conflictCols: string[] = (
        globalThis.Array.isArray(opts.conflictTarget)
          ? opts.conflictTarget
          : [opts.conflictTarget]
      );

      const allCols = Object.keys(flatRows[0] ?? {});
      const updateCols: string[] =
        opts.update ??
        allCols.filter((c) => !conflictCols.includes(c));

      // Reactivate soft-deleted rows on conflict
      if (this.descriptor.softDelete && !updateCols.includes(this.descriptor.softDelete.column)) {
        updateCols.push(this.descriptor.softDelete.column);
        for (const row of flatRows) {
          row[this.descriptor.softDelete.column] = null;
        }
      }

      let totalChanges = 0;
      this.db.transaction(() => {
        const batches = buildUpsertMany(this.tableName, flatRows, conflictCols, updateCols);
        for (const { sql, params } of batches) {
          const result = this._executor.exec(sql, params, "upsertMany");
          totalChanges += result.changes;
        }

        // Re-sync sub-tables: delete old rows, re-insert
        for (const obj of objs) {
          const pkVal = obj[this.descriptor.primaryKey.name];
          for (const sub of this.meta.subTables) {
            this._executor.exec(
              `DELETE FROM "${sub.tableName}" WHERE "_owner_id" = ?`,
              [pkVal as string | number],
              "delete"
            );
            const items = obj[sub.fieldName];
            if (!globalThis.Array.isArray(items) || items.length === 0) continue;
            const rows = flattenSubRows(this._assertPk(pkVal), items, sub, this._codecs);
            for (const row of rows) {
              const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
              this._executor.exec(iSql, iParams, "insert");
            }
          }
        }
      });

      if (this.descriptor.eviction) {
        this._runEviction();
      }
      this._emit("upsertMany", { data: objs, result: totalChanges });
      return totalChanges;
    });
  }

  // ─── Find by PK ────────────────────────────────────────────────────────────

  /**
   * Find a record by its primary key.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const user = orm.users.findById("u1");
   * if (user) console.log(user.name);
   * ```
   */
  findById(id: Infer<TQuery>[PK]): Entity<Infer<TQuery>, Mat, TS> | null {
    return withTrace("repository.findById", { table: this.tableName }, () => {
      const result = this._findByIdRaw(id);
      this._emit("findById", { id, result });
      return result;
    });
  }

  /** Internal findById without event emission - used by update() */
  private _findByIdRaw(id: Infer<TQuery>[PK]): Entity<Infer<TQuery>, Mat, TS> | null {
    const pk = this.descriptor.primaryKey.name;
    const sql = this.descriptor.softDelete
      ? `SELECT * FROM "${this.tableName}" WHERE "${pk}" = ? AND "${this.descriptor.softDelete.column}" IS NULL LIMIT 1`
      : `SELECT * FROM "${this.tableName}" WHERE "${pk}" = ? LIMIT 1`;
    const row = this._executor.get<Record<string, unknown>>(
      sql,
      [id as string | number | bigint | null],
      "findById"
    );
    if (!row) return null;

    if (this.descriptor.eviction?.lruColumn && Math.random() < 0.1) {
      const lruCol = this.descriptor.eviction.lruColumn;
      const pk = this.descriptor.primaryKey.name;
      Promise.resolve().then(() => {
        try {
          this._executor.exec(
            `UPDATE "${this.tableName}" SET "${lruCol}" = ? WHERE "${pk}" = ?`,
            [Date.now(), id as string | number | bigint | null]
          );
        } catch { /* ignore */ }
      });
    }

    return this._wrap(this._hydrateOne(row));
  }

  // ─── Find many ─────────────────────────────────────────────────────────────

  /**
   * Find many records matching the given filters.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const adults = orm.users.findMany({
   *   where: { age: { gte: 18 } },
   *   orderBy: { column: "name", direction: "ASC" },
   *   limit: 10,
   * });
   *
   * // Include sub-tables
   * const orders = orm.orders.findMany({ include: ["lineItems"] });
   * ```
   */
  findMany<const S extends readonly SelectableKeys<TQuery>[], const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S; include: I }): (SelectShape<TQuery, S> & TS & { [K in I[number]]: SubTableItem<TQuery, K>[] })[];
  findMany<const S extends readonly SelectableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S }): (SelectShape<TQuery, S> & TS)[];
  findMany(opts?: FindOptions<TQuery>): Entity<Infer<TQuery>, Mat, TS>[];
  findMany(opts: FindOptions<TQuery> = {}): (Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TQuery>]> & TS)[] {
    return withTrace("repository.findMany", { table: this.tableName }, () => {
      const resolvedOpts = opts.select && opts.include ? this._ensureSelectPk({ ...opts, select: opts.select }) : opts;
      const rows = this._fetchRows(resolvedOpts, "findMany");


      // Probabilistic LRU touch — batched into a single UPDATE
      if (this.descriptor.eviction?.lruColumn) {
        const lruCol = this.descriptor.eviction.lruColumn;
        const pk = this.descriptor.primaryKey.name;
        const touchPks: (string | number)[] = [];
        for (const row of rows) {
          if (Math.random() < 0.1) {
            const pkVal = row[pk];
            if (typeof pkVal === "string" || typeof pkVal === "number") {
              touchPks.push(pkVal);
            }
          }
        }
        if (touchPks.length > 0) {
          const now = Date.now();
          const ph = touchPks.map(() => "?").join(", ");
          Promise.resolve().then(() => {
            try {
              this._executor.exec(
                `UPDATE "${this.tableName}" SET "${lruCol}" = ? WHERE "${pk}" IN (${ph})`,
                [now, ...touchPks] as [number, ...SQLQueryBindings[]]
              );
            } catch { /* ignore */ }
          });
        }
      }

      // N+1-safe sub-table hydration
      const pk = this.descriptor.primaryKey.name;
      const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");

      const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
      for (const sub of this.meta.subTables) {
        const included = !opts.include || opts.include.some((name) => name === sub.fieldName);
        if (!included) continue;
        if (pkValues.length === 0) continue;
        const ph = pkValues.map(() => "?").join(", ");
        const subRows = this._executor.all<Record<string, unknown>>(
          `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" IN (${ph}) ORDER BY "_index" ASC`,
          pkValues,
          "findMany"
        );
        const byOwner = new Map<string | number, Record<string, unknown>[]>();
        for (const r of subRows) {
          const owner = r._owner_id;
          if (typeof owner !== "string" && typeof owner !== "number") continue;
          if (!byOwner.has(owner)) byOwner.set(owner, []);
          byOwner.get(owner)!.push(r);
        }
        prefetchedBySub.set(sub.tableName, byOwner);
      }

      const results = rows.map((r) => {
        const rowPrefetched = new Map<string, Record<string, unknown>[]>();
        for (const sub of this.meta.subTables) {
          const included = !opts.include || opts.include.some((name) => name === sub.fieldName);
          if (!included) continue;
          const byOwner = prefetchedBySub.get(sub.tableName);
          const key = r[pk];
          const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
          rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
        }
        return this._wrap(this._hydrateOne(r, opts.include, opts.select, rowPrefetched));
      });
      this._emit("findMany", { options: opts, result: results });
      return results;
    });
  }

  /**
   * Find many with total count - useful for pagination.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const page = orm.users.findPage({
   *   where: { status: { eq: "active" } },
   *   limit: 10,
   *   offset: 0,
   * });
   * // page.data - the records
   * // page.total - total matching records
   * // page.limit, page.offset - what you passed in
   * ```
   */
  findPage<const S extends readonly SelectableKeys<TQuery>[], const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S; include: I }): PageResult<SelectShape<TQuery, S> & TS & { [K in I[number]]: SubTableItem<TQuery, K>[] }>;
  findPage<const S extends readonly SelectableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S }): PageResult<SelectShape<TQuery, S> & TS>;
  findPage(opts?: FindOptions<TQuery>): PageResult<Entity<Infer<TQuery>, Mat, TS>>;
  findPage(opts: FindOptions<TQuery> = {}): PageResult<Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TQuery>]> & TS> {
    return withTrace("repository.findPage", { table: this.tableName }, () => {
      const resolvedOpts = opts.select && opts.include ? this._ensureSelectPk(opts) : opts;
      const { countSql, countParams } = buildSelect(
        this.tableName,
        resolvedOpts,
        this.descriptor.softDelete?.column,
        this.meta
      );

      const rows = this._fetchRows(resolvedOpts, "findPage")
        .map((r) => this._wrap(this._hydrateOne(r, opts.include, opts.select)));

      const countRow = this._executor.get<{ _count: number }>(
        countSql,
        countParams,
        "count"
      );

      const result = {
        data: rows,
        total: (countRow ?? { _count: 0 })._count,
        limit: opts.limit ?? rows.length,
        offset: opts.offset ?? 0,
      };

      this._emit("findPage", { options: opts, result });
      return result;
    });
  }

  /**
   * Cursor-based pagination (seek method). Avoids OFFSET degradation on
   * large tables by using a boundary value from the previous page.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const page = orm.orders.findCursorPage({
   *   orderBy: { column: "DocumentDate", direction: "DESC" },
   *   limit: 25,
   * });
   *
   * const next = orm.orders.findCursorPage({
   *   orderBy: { column: "DocumentDate", direction: "DESC" },
   *   cursor: page.nextCursor!,
   *   limit: 25,
   * });
   * ```
   */
  findCursorPage(opts: {
    where?: WhereClause<TQuery>;
    orderBy: OrderByClause<TQuery>;
    cursor?: CursorInput;
    limit?: number;
  }): CursorPageResult<Entity<Infer<TQuery>, Mat, TS>> {
    return withTrace("repository.findCursorPage", { table: this.tableName }, () => {
      const direction = opts.orderBy.direction ?? "ASC";
      const colRef = resolveOrderByColumn(opts.orderBy.column, this.meta);
      const limit = opts.limit ?? 25;

      const { sql: whereSql, params: whereParams } = buildWhere(
        opts.where,
        this.descriptor.softDelete?.column,
        this.meta
      );

      let sql = `SELECT * FROM "${this.tableName}"`;
      const params: SQLQueryBindings[] = [...whereParams];

      if (opts.cursor) {
        const cursorCol = resolveOrderByColumn(opts.cursor.column, this.meta);
        const op = opts.cursor.direction === "next"
          ? (direction === "ASC" ? ">" : "<")
          : (direction === "ASC" ? "<" : ">");
        const cursorCondition = `${cursorCol} ${op} ?`;
        params.push(opts.cursor.value);

        if (whereSql) {
          sql += ` ${whereSql} AND ${cursorCondition}`;
        } else {
          sql += ` WHERE ${cursorCondition}`;
        }
      } else {
        if (whereSql) sql += ` ${whereSql}`;
      }

      const queryDirection = opts.cursor?.direction === "prev"
        ? (direction === "ASC" ? "DESC" : "ASC")
        : direction;

      sql += ` ORDER BY ${colRef} ${queryDirection} LIMIT ${limit}`;

      const rows = this._executor.all<Record<string, unknown>>(
        sql,
        params,
        "findCursorPage"
      );

      let results = rows.map((r) => this._wrap(this._hydrateOne(r)));
      if (opts.cursor?.direction === "prev") {
        results.reverse();
      }

      const nextCursor: Cursor | null = results.length === limit
        ? { column: opts.orderBy.column, value: (results[results.length - 1] as Record<string, unknown>)[opts.orderBy.column] } as Cursor
        : null;

      const prevCursor: Cursor | null = results.length > 0
        ? { column: opts.orderBy.column, value: (results[0] as Record<string, unknown>)[opts.orderBy.column] } as Cursor
        : null;

      const result = { data: results, nextCursor, prevCursor };
      this._emit("findCursorPage", { options: opts, result });
      return result;
    });
  }

  /**
   * Find a single record matching the given filters. Equivalent to `findMany`
   * with `limit: 1`, but returns the entity directly (or `null`).
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const admin = orm.users.findOne({
   *   where: { role: { eq: "admin" } },
   * });
   * ```
   */
  findOne<const S extends readonly SelectableKeys<TQuery>[], const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S; include: I }): (SelectShape<TQuery, S> & TS & { [K in I[number]]: SubTableItem<TQuery, K>[] }) | null;
  findOne<const S extends readonly SelectableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S }): (SelectShape<TQuery, S> & TS) | null;
  findOne(opts?: FindOptions<TQuery>): Entity<Infer<TQuery>, Mat, TS> | null;
  findOne(opts: FindOptions<TQuery> = {}): (Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TWrite>]> & TS) | null {
    return withTrace("repository.findOne", { table: this.tableName }, () => {
      const resolvedOpts = opts.select && opts.include ? this._ensureSelectPk(opts) : opts;
      const rows = this._fetchRows({ ...resolvedOpts, limit: 1 }, "findOne");
      const row = rows.length > 0 ? rows[0]! : null;
      const result = row ? this._wrap(this._hydrateOne(row, opts.include, opts.select)) : null;
      this._emit("findOne", { options: opts, result });
      return result;
    });
  }

  /**
   * Iterate over records matching the given filters, yielding one row at a time.
   * Sub-tables are hydrated in windows to keep memory stable.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * for (const user of orm.users.iterate({ where: { active: { eq: true } } })) {
   *   console.log(user.name);
   * }
   * ```
   */
  iterate<const S extends readonly SelectableKeys<TQuery>[], const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S; include: I }): Generator<SelectShape<TQuery, S> & TS & { [K in I[number]]: SubTableItem<TQuery, K>[] }>;
  iterate<const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { include: I }): Generator<Entity<Infer<TQuery>, Mat, TS> & { [K in I[number]]: SubTableItem<TQuery, K>[] }>;
  iterate<const S extends readonly SelectableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S }): Generator<SelectShape<TQuery, S> & TS>;
  iterate(opts?: FindOptions<TQuery>): Generator<Entity<Infer<TQuery>, Mat, TS>>;
  *iterate(opts: FindOptions<TQuery> = {}): Generator<Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TWrite>]> & TS> {
    enterTrace("repository.iterate", { table: this.tableName });
    try {
      const resolvedOpts = opts.select && opts.include ? this._ensureSelectPk(opts) : opts.select ? this._ensureSelectPk(opts) : opts;
      const { sql, params } = buildSelectSql(this.tableName, resolvedOpts, this.descriptor.softDelete?.column, this.meta);
      const gen = this._executor.iterate<Record<string, unknown>>(sql, params, "iterate");

      if (!opts.include || opts.include.length === 0) {
        for (const row of gen) {
          yield this._wrap(this._hydrateOne(row, undefined, opts.select));
        }
        return;
      }

      const pk = this.descriptor.primaryKey.name;
      const windowSize = 100;
      let buffer: Record<string, unknown>[] = [];

      for (const row of gen) {
        buffer.push(row);
        if (buffer.length >= windowSize) {
          yield* this._hydrateWindow(buffer, opts.include, opts.select);
          buffer = [];
        }
      }

      if (buffer.length > 0) {
        yield* this._hydrateWindow(buffer, opts.include, opts.select);
      }
    } finally {
      leaveTrace();
    }
  }

  private *_hydrateWindow(
    rows: Record<string, unknown>[],
    include: string[],
    select?: string[]
  ): Generator<Entity<Infer<TQuery>, Mat, TS>> {
    const pk = this.descriptor.primaryKey.name;
    const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");

    const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
    for (const sub of this.meta.subTables) {
      const included = include.some((name) => name === sub.fieldName);
      if (!included) continue;
      if (pkValues.length === 0) continue;
      const ph = pkValues.map(() => "?").join(", ");
      const subRows = this._executor.all<Record<string, unknown>>(
        `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" IN (${ph}) ORDER BY "_index" ASC`,
        pkValues,
        "iterate"
      );
      const byOwner = new Map<string | number, Record<string, unknown>[]>();
      for (const r of subRows) {
        const owner = r._owner_id;
        if (typeof owner !== "string" && typeof owner !== "number") continue;
        if (!byOwner.has(owner)) byOwner.set(owner, []);
        byOwner.get(owner)!.push(r);
      }
      prefetchedBySub.set(sub.tableName, byOwner);
    }

    for (const row of rows) {
      const rowPrefetched = new Map<string, Record<string, unknown>[]>();
      for (const sub of this.meta.subTables) {
        const included = include.some((name) => name === sub.fieldName);
        if (!included) continue;
        const byOwner = prefetchedBySub.get(sub.tableName);
        const key = row[pk];
        const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
        rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
      }
      yield this._wrap(this._hydrateOne(row, include, select, rowPrefetched));
    }
  }

  /**
   * Find many with resolved relations (n+1 safe). If you have cross-table
   * relations configured, this eagerly loads them in a single batch query.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const orders = orm.orders.findManyMaterialized();
   * for (const item of orders[0].lineItems) {
   *   console.log(item.product.name); // eagerly resolved
   * }
   * ```
   */
  findManyMaterialized(opts: FindOptions<TQuery> = {}): Entity<Infer<TQuery>, Mat, TS>[] {
    const rows = this.findMany(opts);
    if (!this._materializeMany) return rows;
    const materialized = this._materializeMany(
      rows as Record<string, unknown>[]
    );
    // Re-attach entity prototype in case materializeMany created copies
    if (this._entityProto) {
      for (const row of materialized) {
        if (Object.getPrototypeOf(row) !== this._entityProto) {
          Object.setPrototypeOf(row, this._entityProto);
        }
      }
    }
    return materialized as Entity<Infer<TQuery>, Mat, TS>[];
  }

  // ─── Count ─────────────────────────────────────────────────────────────────

  /**
   * Count records matching the given filters.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const total = orm.users.count();
   * const adults = orm.users.count({ age: { gte: 18 } });
   * ```
   */
  count(where?: WhereClause<TQuery>): number {
    return withTrace("repository.count", { table: this.tableName }, () => {
      const { sql, params } = buildWhere(where, this.descriptor.softDelete?.column, this.meta);
      const fullSql = `SELECT COUNT(*) as "_count" FROM "${this.tableName}" ${sql}`.trim();
      const row = this._executor.get<{ _count: number }>(
        fullSql,
        params,
        "count"
      );
      const result = (row ?? { _count: 0 })._count;
      this._emit("count", { where, result });
      return result;
    });
  }

  /**
   * Run aggregate queries (sum, count, avg, min, max) with optional
   * grouping and filtering.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * orm.orders.aggregate({
   *   aggregations: { total: { sum: "amount" } },
   * });
   *
   * orm.orders.aggregate({
   *   groupBy: ["status"],
   *   aggregations: { count: { count: "*" }, avgAmount: { avg: "amount" } },
   * });
   * ```
   */
  aggregate<
    const A extends Record<string, AggregationOp<TQuery>>,
    const G extends readonly (ScalarKeys<TQuery> | import("./types.ts").ScalarJsonPath<TQuery>)[] | undefined = undefined
  >(
    opts: AggregateOptions<TQuery, A> & { groupBy?: G }
  ): AggregateResult<TQuery, A, G> {
    return withTrace("repository.aggregate", { table: this.tableName }, () => {
      const { sql, params } = buildAggregateSql(this.tableName, opts, this.descriptor.softDelete?.column, this.meta);
      const rows = this._executor.all<AggregateResult<TQuery, A, G>[number]>(sql, params, "aggregate");
      this._emit("aggregate", { options: opts, result: rows });
      return rows;
    });
  }

  /**
   * Run window function queries (rowNumber, rank, denseRank, lead, lag)
   * with partitioning and ordering.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * orm.orders.windowQuery({
   *   partitionBy: ["Status__Group"],
   *   orderBy: [{ column: "DocumentDate", direction: "DESC" }],
   *   select: {
   *     rowNumber: { rowNumber: true },
   *     rank: { rank: true },
   *     leadTotal: { lead: "TotalTurnover", offset: 1 },
   *   },
   *   limit: 100,
   * });
   * ```
   */
  windowQuery<const W extends Record<string, import("./types.ts").WindowFunction<TQuery>>>(
    opts: WindowQueryOptions<TQuery> & { select: W }
  ): WindowResult<TQuery, W> {
    return withTrace("repository.windowQuery", { table: this.tableName }, () => {
      const { sql, params } = buildWindowSql(this.tableName, opts, this.descriptor.softDelete?.column, this.meta);
      const rows = this._executor.all<WindowResult<TQuery, W>[number]>(sql, params, "windowQuery");
      this._emit("windowQuery", { options: opts, result: rows });
      return rows;
    });
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  /**
   * Update a record - must include the primary key. Returns the updated
   * entity, or `null` if no record matched.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * orm.users.update({ id: "u1", name: "alice smith" });
   * ```
   */
  update(data: UpdateData<TWrite, PK>): Entity<Infer<TQuery>, Mat, TS> | null {
    return withTrace("repository.update", { table: this.tableName }, () => {
      const obj = this._record(data as Infer<TWrite>);
      const pk = this.descriptor.primaryKey.name;
      const rawPk = obj[pk];
      if (rawPk === undefined || rawPk === null) {
        raise("UPDATE_MISSING_PK", `foxdb: update() requires primary key "${pk}"`, {
          table: this.tableName,
          column: pk,
        });
      }

      // Fetch existing, merge, validate - use raw find to avoid spurious read events
      const existing = this._findByIdRaw(this._assertPk(rawPk) as Infer<TQuery>[PK]);
      if (!existing) return null;

      const merged = this.parse({ ...existing, ...data });
      const mergedObj = this._record(merged);
      if (this._timestampNames.updatedAt) {
        mergedObj[this._timestampNames.updatedAt] = Date.now();
      }
      const flat = flattenRow(mergedObj, this.meta, this._codecs);
      const patch = Object.fromEntries(
        Object.entries(flat).filter(([k]) => k !== pk)
      );

      this.db.transaction(() => {
        const { sql, params } = buildUpdate(this.tableName, pk, this._assertPk(rawPk), patch);
        this._executor.exec(sql, params, "update");

        // Re-sync sub-tables
        for (const sub of this.meta.subTables) {
          this._executor.exec(
            `DELETE FROM "${sub.tableName}" WHERE "_owner_id" = ?`,
            [this._assertPk(rawPk)],
            "delete"
          );

          const items = mergedObj[sub.fieldName];
          if (!globalThis.Array.isArray(items) || items.length === 0) continue;
          const rows = flattenSubRows(this._assertPk(rawPk), items, sub, this._codecs);
          for (const row of rows) {
            const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
            this._executor.exec(iSql, iParams, "insert");
          }
        }
      });

      const result = this._wrap(mergedObj);
      this._emit("update", { id: rawPk, data: { ...data } });
      return result;
    });
  }

  /**
   * Update multiple records matching the given filters.
   * Returns the number of rows changed.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * orm.users.updateWhere({
   *   where: { status: { eq: "pending" } },
   *   data: { status: { group: "completed" } },
   * });
   * ```
   */
  updateWhere(opts: UpdateWhereOptions<TWrite, PK>): number {
    return withTrace("repository.updateWhere", { table: this.tableName }, () => {
      const obj = this._record(opts.data as Infer<TWrite>);
      const patch = flattenPatch(obj, this.meta, this._codecs);
      if (this._timestampNames.updatedAt && this._timestampNames.updatedAt in patch === false) {
        patch[this._timestampNames.updatedAt] = Date.now();
      }

      const softDeleteCol = opts.includeDeleted ? undefined : this.descriptor.softDelete?.column;
      const { sql, params } = buildUpdateWhere(
        this.tableName,
        patch,
        opts.where,
        softDeleteCol,
        this.meta
      );
      const result = this._executor.exec(sql, params, "updateWhere");
      this._emit("updateWhere", { where: opts.where, result: result.changes });
      return result.changes;
    });
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  /**
   * Delete a record by its primary key. Returns `true` if a record was deleted.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * const deleted = orm.users.deleteById("u1");
   * ```
   */
  deleteById(id: Infer<TWrite>[PK]): boolean {
    return withTrace("repository.deleteById", { table: this.tableName }, () => {
      const pk = this.descriptor.primaryKey.name;

      if (this.descriptor.softDelete) {
        const col = this.descriptor.softDelete.column;
        this._executor.exec(
          `UPDATE "${this.tableName}" SET "${col}" = ? WHERE "${pk}" = ?`,
          [Date.now(), id as string | number],
          "delete"
        );
        this._emit("delete", { id });
        return true;
      }

      const result = this.db.transaction(() => {
        for (const sub of this.meta.subTables) {
          this._executor.exec(
            `DELETE FROM "${sub.tableName}" WHERE "_owner_id" = ?`,
            [id as string | number],
            "delete"
          );
        }
        const result = this._executor.exec(
          `DELETE FROM "${this.tableName}" WHERE "${pk}" = ?`,
          [id as string | number],
          "delete"
        );
        return result.changes > 0;
      });
      this._emit("delete", { id });
      return result;
    });
  }

  /**
   * Delete records matching the given filters. Returns the number of rows deleted.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * const removed = orm.users.deleteWhere({ status: { eq: "banned" } });
   * ```
   */
  deleteWhere(where: WhereClause<TQuery>): number {
    return withTrace("repository.deleteWhere", { table: this.tableName }, () => {
      const pk = this.descriptor.primaryKey.name;

      if (this.descriptor.softDelete) {
        const col = this.descriptor.softDelete.column;
        const { sql: whereSql, params } = buildWhere(where, col, this.meta);
        const fullSql = `UPDATE "${this.tableName}" SET "${col}" = ? ${whereSql}`.trim();
        const changes = this._executor.exec(fullSql, [Date.now(), ...params] as [number, ...SQLQueryBindings[]], "deleteWhere").changes;
        this._emit("deleteWhere", { where, result: changes });
        return changes;
      }

      const { sql: whereSql, params } = buildWhere(where, undefined, this.meta);

      const changes = this.db.transaction(() => {
        // Cascade to sub-tables first
        for (const sub of this.meta.subTables) {
          const delSubSql = `DELETE FROM "${sub.tableName}" WHERE "_owner_id" IN (SELECT "${pk}" FROM "${this.tableName}" ${whereSql})`.trim();
          this._executor.exec(delSubSql, params, "delete");
        }

        const delSql = `DELETE FROM "${this.tableName}" ${whereSql}`.trim();
        const result = this._executor.exec(delSql, params, "delete");
        return result.changes;
      });

      this._emit("deleteWhere", { where, result: changes });
      return changes;
    });
  }

  // ─── Table lifecycle ───────────────────────────────────────────────────────

  /**
   * Truncate the table and all sub-tables. Deletes all rows but keeps the schema.
   *
   * @group Lifecycle
   *
   * @example
   * ```ts
   * orm.users.flush(); // users table is now empty
   * ```
   */
  flush(): void {
    withTrace("repository.flush", { table: this.tableName }, () => {
      this.db.exec(`DELETE FROM "${this.tableName}"`);
      for (const sub of this.meta.subTables) {
        this.db.exec(`DELETE FROM "${sub.tableName}"`);
      }
      this._emit("flush", {});
    });
  }

  /**
   * Drop the table and all sub-tables. **This destroys the schema and all data.**
   *
   * @group Lifecycle
   *
   * @example
   * ```ts
   * orm.users.drop(); // table no longer exists
   * ```
   */
  drop(): void {
    for (const sub of this.meta.subTables) {
      this.db.exec(`DROP TABLE IF EXISTS "${sub.tableName}"`);
    }
    this.db.exec(`DROP TABLE IF EXISTS "${this.tableName}"`);
  }

  // ─── Sub-table hydration ───────────────────────────────────────────────────

  private _hydrateOne(
    flat: Record<string, unknown>,
    include?: string[],
    select?: string[],
    prefetched?: Map<string, Record<string, unknown>[]>
  ): Record<string, unknown> {
    const pk = this.descriptor.primaryKey.name;
    const pkVal = flat[pk];

    const subRows = new Map<string, Record<string, unknown>[]>();
    for (const sub of this.meta.subTables) {
      if (include && !include.includes(sub.fieldName)) {
        subRows.set(sub.tableName, []);
        continue;
      }

      const subMeta: TableMeta = {
        tableName: sub.tableName,
        columns: sub.columns,
        subTables: [],
        columnByName: sub.columnByName,
        columnByPath: sub.columnByPath,
      };

      if (prefetched && prefetched.has(sub.tableName)) {
        const rows = prefetched.get(sub.tableName)!;
        const cleaned = rows.map((r) => {
          const rest: Record<string, unknown> = {};
          for (const key of Object.keys(r)) {
            if (key !== "_id" && key !== "_owner_id" && key !== "_index") {
              rest[key] = r[key];
            }
          }
          return hydrateRow(rest, subMeta, new Map(), this._codecs);
        });
        subRows.set(sub.tableName, cleaned);
        continue;
      }

      const rows = this._executor.all<Record<string, unknown>>(
        `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" = ? ORDER BY "_index" ASC`,
        [pkVal as string | number],
        "read"
      );

      const cleaned = rows.map((r) => {
        const rest: Record<string, unknown> = {};
        for (const key of Object.keys(r)) {
          if (key !== "_id" && key !== "_owner_id" && key !== "_index") {
            rest[key] = r[key];
          }
        }
        return hydrateRow(rest, subMeta, new Map(), this._codecs);
      });

      subRows.set(sub.tableName, cleaned);
    }

    return hydrateRow(flat, this.meta, subRows, this._codecs, select, include);
  }

  // ─── Raw access ────────────────────────────────────────────────────────────

  /**
   * Run raw SQL - escape hatch for queries the ORM doesn't support directly.
   *
   * @group Raw SQL
   *
   * @example
   * ```ts
   * const rows = orm.users.raw<{ name: string; count: number }>(
   *   'SELECT name, COUNT(*) as count FROM users GROUP BY name'
   * );
   * ```
   */
  raw<R = import("./types.ts").DBRow>(sql: string, ...params: import("./types.ts").DBValue[]): R[] {
    return this._executor.all<R>(sql, params as SQLQueryBindings[], "raw");
  }
}