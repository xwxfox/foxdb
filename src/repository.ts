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
import { traceBegin, traceEnd, sqlDebug, sqlFileWrite, sqlFileSection } from "./tracing.ts";
import {
  introspectTable,
  buildCreateTableSQL,
  buildIndexSQL,
  flattenRow,
  flattenPatch,
  flattenSubRows,
  hydrateRow,
  convertGeneratedConfig,
  compileHydrateRowFn,
  EMPTY_MAP,
  type TableMeta,
  type ColumnMeta,
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
  toBinding,
} from "./query-builder.ts";
import { buildAggregateSql } from "./aggregate.ts";
import { buildWindowSql } from "./window.ts";
import { BatchWriter, type BatchWriterOptions } from "./batch-writer.ts";
import { resolveTimestampNames, DEFAULT_TIMESTAMP_NAMES } from "./timestamps.ts";
import type { TimestampConfig } from "./timestamps.ts";
import type { ReadScheduler } from "./asyncDatabasePool/scheduler.ts";
import {
  FilterBuilder,
  AggregateBuilder,
  buildWhereFromNodes,
  type InternalBuilderState,
  type AggregateBuilderState,
  type ConditionNode,
} from "./filter-builder.ts";

/** Safely build a Cursor from a dynamic row access. */
function cursorValue(
  row: Record<string, unknown>,
  column: string
): SqliteScalar {
  const v = row[column];
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return v;
  return null;
}

// --- Repository ---------------------------------------------------------------

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

  /**
   * Get the underlying SQLite table name for a sub-table by field name.
   * Returns undefined if the field is not a sub-table (array relationship).
   *
   * @example
   * ```ts
   * orm.purchases.getSubTableName("PurchaseLineItems")
   * // => "archivedPurchases__PurchaseLineItems"
   * ```
   */
  getSubTableName(fieldName: string): string | undefined {
    return this.meta.subTables.find((st) => st.fieldName === fieldName)?.tableName;
  }

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
  private readonly _insertColsSql: string;
  private readonly _insertPlaceholders: string;
  private readonly _readScheduler?: ReadScheduler;
  private readonly _allColumnNames: string[];

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
    db: BunDatabase,
    readScheduler?: ReadScheduler
  ) {
    this.tableName = tableName;
    this.descriptor = config;
    this.db = db;
    this._readScheduler = readScheduler;
    this._executor = new QueryExecutor({ db, tableName: this.tableName });
    this.meta = introspectTable(
      tableName,
      config.schema,
      convertGeneratedConfig(config.generated),
      config.primaryKey.name,
    );

    // Auto-add timestamp columns when timestamps is enabled
    if (config.timestamps) {
      const tsConfig = typeof config.timestamps === "object" ? config.timestamps : {};
      const createdAtName = tsConfig.createdAt ?? DEFAULT_TIMESTAMP_NAMES.createdAt;
      const updatedAtName = tsConfig.updatedAt ?? DEFAULT_TIMESTAMP_NAMES.updatedAt;

      for (const colName of [createdAtName, updatedAtName]) {
        if (!this.meta.columnByName.has(colName)) {
          const col: ColumnMeta = {
            name: colName,
            sqlType: "INTEGER",
            nullable: false,
            optional: false,
            _get: (obj: Record<string, unknown>) => obj[colName],
          };
          this.meta.columns.push(col);
          this.meta.columnByName.set(colName, col);
          this.meta.insertColumns.push(col);
          this.meta.insertColumnNames.push(colName);
        }
      }
      this.meta._hydrateFast = compileHydrateRowFn(this.meta);
    }

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

    this._allColumnNames = this.meta.columns.map((c) => c.name);

    // Prebuild INSERT SQL template (columns never change per table)
    this._insertColsSql = this.meta.insertColumnNames.map((k) => `"${k}"`).join(", ");
    this._insertPlaceholders = this.meta.insertColumnNames.map(() => "?").join(", ");

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
    traceBegin("repo.fetchRows");
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
      traceBegin("repo.fetchRows.singlePhase");
      const { sql, params } = buildSelect(
        this.tableName,
        opts,
        softDeleteCol,
        this.meta
      );
      const result = this._executor.all<Record<string, unknown>>(
        sql,
        params,
        operation
      );
      traceEnd();
      traceEnd({ phase: "single", rows: result.length });
      return result;
    }

    // Phase 1: fetch only PKs (covers index-only scans)
    traceBegin("repo.fetchRows.phase1");
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
    traceEnd({ matched: pkValues.length });

    if (pkValues.length === 0) {
      traceEnd({ phase: "twoPhase", matched: 0 });
      return [];
    }

    // SQLite host parameter limit is 999; batch phase 2 in groups of 500
    if (pkValues.length > 500) {
      traceBegin("repo.fetchRows.phase2Batched");
      const allRows: Record<string, unknown>[] = [];
      for (let i = 0; i < pkValues.length; i += 500) {
        const batch = pkValues.slice(i, i + 500);
        const ph = batch.map(() => "?").join(", ");
        const batchRows = this._executor.all<Record<string, unknown>>(
          `SELECT * FROM "${this.tableName}" WHERE "${pk}" IN (${ph})`,
          batch,
          operation
        );
        for (const r of batchRows) allRows.push(r);
      }
      const pkOrder = new Map(pkValues.map((v, i) => [v, i]));
      allRows.sort((a, b) => {
        const av = a[pk];
        const bv = b[pk];
        const ai = pkOrder.get(av as string | number) ?? 0;
        const bi = pkOrder.get(bv as string | number) ?? 0;
        return ai - bi;
      });
      traceEnd({ rows: allRows.length });
      traceEnd({ phase: "twoPhase_batched", rows: allRows.length });
      return allRows;
    }

    // Phase 2: fetch full rows for the matching PKs
    traceBegin("repo.fetchRows.phase2");
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
    traceEnd({ rows: rows.length });
    traceEnd({ phase: "twoPhase", rows: rows.length });
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

  /** Wrap raw data in an entity object (with sub-table fields) */
  private _wrap(data: Record<string, unknown>): Entity<Infer<TQuery>, Mat, TS> {
    if (!this._entityProto) return data as Entity<Infer<TQuery>, Mat, TS>;
    const entity = Object.create(this._entityProto);
    Object.assign(entity, data);
    return entity as Entity<Infer<TQuery>, Mat, TS>;
  }

  /** Wrap raw data in an entity object (without sub-table fields) */
  private _wrapNoSubs(data: Record<string, unknown>): Entity<Infer<TQuery>, Mat, TS> {
    if (!this._entityProto) return data as Entity<Infer<TQuery>, Mat, TS>;
    const entity = Object.create(this._entityProto);
    Object.assign(entity, data);
    return entity as Entity<Infer<TQuery>, Mat, TS>;
  }

  /** Narrow a parsed schema value to a plain record for dynamic property access */
  private _record(value: Infer<TWrite>): Record<string, unknown> {
    return value;
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

  // --- Migration -------------------------------------------------------------

  private _migrate(): void {
    const pk = this.descriptor.primaryKey.name;
    const configIndexes = this.descriptor.indexes ?? [];
    sqlFileSection(`DDL: ${this.tableName}`);
    sqlDebug(`ddl.migrate starting for table ${this.tableName}`, {
      primaryKey: pk,
      totalDDLStatements: "(computed by buildCreateTableSQL)",
      userIndexes: configIndexes.length,
      userIndexDetails: configIndexes.map((idx) => ({
        columns: idx.columns.map((c) => c.name),
        unique: idx.unique ?? false,
        name: idx.name,
        where: idx.where,
      })),
      subTables: this.meta.subTables.map((s) => ({ fieldName: s.fieldName, tableName: s.tableName, isScalar: s.isScalar })),
    });
    const stmts = buildCreateTableSQL(this.meta, pk, this.descriptor.autoIndex ?? true);
    sqlDebug(`ddl.migrate DDL statements count`, { count: stmts.length + configIndexes.length });
    this.db.transaction(() => {
      for (const sql of stmts) {
        sqlFileWrite(sql);
        this.db.exec(sql);
      }

      for (const idx of configIndexes) {
        const idxSql = buildIndexSQL(
          this.tableName,
          idx.columns.map((c) => c.name),
          idx.unique ?? false,
          idx.name,
          idx.where,
          idx.include?.map((c) => c.name)
        );
        sqlFileWrite(idxSql);
        sqlDebug(`ddl.userIndex for ${this.tableName}`, {
          sql: idxSql,
          columns: idx.columns.map((c) => c.name),
          unique: idx.unique ?? false,
          where: idx.where,
          reason: "user-configured index in table() descriptor",
        });
        this.db.exec(idxSql);
      }
    });
  }

  // --- Eviction --------------------------------------------------------------

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

  // --- Validation ------------------------------------------------------------

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

  // --- Insert ----------------------------------------------------------------

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
      traceBegin("repo.insert.parse");
      const parsed = this.parse(data);
      const obj = this._record(parsed);
      traceEnd();
      const now = Date.now();
      if (this._timestampNames.createdAt) obj[this._timestampNames.createdAt] = now;
      if (this._timestampNames.updatedAt) obj[this._timestampNames.updatedAt] = now;

      const doInsert = () => {
        traceBegin("repo.insert.flatten");
        const flat = flattenRow(obj, this.meta, this._codecs);
        traceEnd();

        traceBegin("repo.insert.execMain");
        const params = this.meta.insertColumnNames.map((k) => flat[k] as SQLQueryBindings);
        this._executor.exec(
          `INSERT INTO "${this.tableName}" (${this._insertColsSql}) VALUES (${this._insertPlaceholders})`,
          params,
          "insert"
        );
        traceEnd();

        const pkVal = obj[this.descriptor.primaryKey.name];

        traceBegin("repo.insert.subTables");
        for (const sub of this.meta.subTables) {
          const items = obj[sub.fieldName];
          if (!globalThis.Array.isArray(items) || items.length === 0) continue;
          const rows = flattenSubRows(this._assertPk(pkVal), items, sub, this._codecs);
          if (rows.length > 0) {
            const batches = buildInsertMany(sub.tableName, rows, 999, sub.insertColsSql, sub.insertValueGroup, sub.insertColumnNames);
            for (const { sql, params: iParams } of batches) {
              this._executor.exec(sql, iParams, "insert");
            }
          }
        }
        traceEnd();
      };

      if (this.db._txDepth > 0) {
        doInsert();
      } else {
        this.db.transaction(doInsert);
      }

      if (this.descriptor.eviction) {
        this._runEviction();
      }
      this._emit("insert", { data: obj });
      return this._wrapNoSubs(obj);
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
      traceBegin("repo.insertMany.parse");
      const parsed = records.map((r) => this.parse(r));
      const objs = parsed.map((p) => {
        const obj = this._record(p);
        const now = Date.now();
        if (this._timestampNames.createdAt) obj[this._timestampNames.createdAt] = now;
        if (this._timestampNames.updatedAt) obj[this._timestampNames.updatedAt] = now;
        return obj;
      });
      traceEnd();

      traceBegin("repo.insertMany.flatten");
      const flatRows = objs.map((obj) => flattenRow(obj, this.meta, this._codecs));
      traceEnd();

      this.db.transaction(() => {
        traceBegin("repo.insertMany.buildInsertMany");
        const batches = buildInsertMany(this.tableName, flatRows);
        traceEnd();

        traceBegin("repo.insertMany.execBatches");
        for (const { sql, params } of batches) {
          this._executor.exec(sql, params, "insertMany");
        }
        traceEnd();

        traceBegin("repo.insertMany.subTables");
        for (const sub of this.meta.subTables) {
          const allSubRows: Record<string, unknown>[] = [];
          for (const obj of objs) {
            const pkVal = obj[this.descriptor.primaryKey.name];
            const items = obj[sub.fieldName];
            if (!globalThis.Array.isArray(items) || items.length === 0) continue;
            const rows = flattenSubRows(this._assertPk(pkVal), items, sub, this._codecs);
            for (const row of rows) allSubRows.push(row);
          }
          if (allSubRows.length > 0) {
            const subBatches = buildInsertMany(sub.tableName, allSubRows, 999, sub.insertColsSql, sub.insertValueGroup, sub.insertColumnNames);
            for (const { sql, params } of subBatches) {
              this._executor.exec(sql, params, "insertMany");
            }
          }
        }
        traceEnd();
      });

      if (this.descriptor.eviction) {
        this._runEviction();
      }
      this._emit("insertMany", { data: objs });
      return objs.map((obj) => this._wrapNoSubs(obj));
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

  // --- Upsert ----------------------------------------------------------------

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
          if (rows.length > 0) {
            const subBatches = buildInsertMany(sub.tableName, rows, 999, sub.insertColsSql, sub.insertValueGroup, sub.insertColumnNames);
            for (const { sql: iSql, params: iParams } of subBatches) {
              this._executor.exec(iSql, iParams, "insert");
            }
          }
        }
      });

      if (this.descriptor.eviction) {
        this._runEviction();
      }
      this._emit("upsert", { data: parsed });
      return this._wrapNoSubs(this._record(parsed));
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
        for (const sub of this.meta.subTables) {
          const allSubRows: Record<string, unknown>[] = [];
          for (const obj of objs) {
            const pkVal = this._assertPk(obj[this.descriptor.primaryKey.name]);
            this._executor.exec(
              `DELETE FROM "${sub.tableName}" WHERE "_owner_id" = ?`,
              [pkVal],
              "delete"
            );
            const items = obj[sub.fieldName];
            if (!globalThis.Array.isArray(items) || items.length === 0) continue;
            const rows = flattenSubRows(pkVal, items, sub, this._codecs);
            for (const row of rows) allSubRows.push(row);
          }
          if (allSubRows.length > 0) {
            const subBatches = buildInsertMany(sub.tableName, allSubRows, 999, sub.insertColsSql, sub.insertValueGroup, sub.insertColumnNames);
            for (const { sql, params } of subBatches) {
              this._executor.exec(sql, params, "upsertMany");
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

  // --- Find by PK ------------------------------------------------------------

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
    traceBegin("repo.findByIdRaw.query");
    const pk = this.descriptor.primaryKey.name;
    const sql = this.descriptor.softDelete
      ? `SELECT * FROM "${this.tableName}" WHERE "${pk}" = ? AND "${this.descriptor.softDelete.column}" IS NULL LIMIT 1`
      : `SELECT * FROM "${this.tableName}" WHERE "${pk}" = ? LIMIT 1`;
    const row = this._executor.get<Record<string, unknown>>(sql, [id as string | number], "findById");
    traceEnd({ found: !!row });
    if (!row) return null;
    return this._wrap(this._hydrateOne(row));
  }

  /** Internal raw row fetch without hydration - used by update() */
  private _findFlatRow(id: Infer<TQuery>[PK]): Record<string, unknown> | null {
    const pk = this.descriptor.primaryKey.name;
    const sql = this.descriptor.softDelete
      ? `SELECT * FROM "${this.tableName}" WHERE "${pk}" = ? AND "${this.descriptor.softDelete.column}" IS NULL LIMIT 1`
      : `SELECT * FROM "${this.tableName}" WHERE "${pk}" = ? LIMIT 1`;
    return this._executor.get<Record<string, unknown>>(
      sql,
      [id as string | number | bigint | null],
      "findById"
    );
  }

  // --- Find many -------------------------------------------------------------

  /**
   * Find many records matching the given filters.
   * Legacy object-based API - use `findMany()` chain API for new code.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const adults = orm.users.O_findMany({
   *   where: { age: { gte: 18 } },
   *   orderBy: { column: "name", direction: "ASC" },
   *   limit: 10,
   * });
   * ```
   */
  O_findMany<const S extends readonly SelectableKeys<TQuery>[], const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S; include: I }): (SelectShape<TQuery, S> & { [K in I[number]]: SubTableItem<TQuery, K>[] })[];
  O_findMany<const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { include: I }): (Entity<Infer<TQuery>, Mat, TS> & { [K in I[number]]: SubTableItem<TQuery, K>[] })[];
  O_findMany<const S extends readonly SelectableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S }): (SelectShape<TQuery, S>)[];
  O_findMany(opts?: FindOptions<TQuery>): Entity<Infer<TQuery>, Mat, TS>[];
  O_findMany(opts: FindOptions<TQuery> = {}): (Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TQuery>]>)[] {
    return withTrace("repository.findMany", { table: this.tableName }, () => {
      traceBegin("repo.findMany.fetchRows");
      // Default limit of 1000 to prevent unbounded memory consumption
      const resolvedOpts = {
        ...(opts.include ? this._ensureSelectPk(opts) : opts),
        limit: opts.limit ?? 1000,
      };
      const rows = this._fetchRows(resolvedOpts, "findMany");
      traceEnd({ rows: rows.length });


      // Probabilistic LRU touch - batched into a single UPDATE
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

      // N+1-safe sub-table hydration (only when include is explicitly requested)
      traceBegin("repo.findMany.prefetchSubs");
      const pk = this.descriptor.primaryKey.name;
      const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");

      const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
      if (opts.include && opts.include.length > 0) {
        for (const sub of this.meta.subTables) {
          const included = opts.include.some((name) => name === sub.fieldName);
          if (!included) continue;
          if (pkValues.length === 0) continue;
          traceBegin(`repo.findMany.prefetch.${sub.fieldName}`);
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
          traceEnd({ subRows: subRows.length });
        }
      }
      traceEnd();

      traceBegin("repo.findMany.hydrate");
      if (opts.include && opts.include.length > 0) {
        const results = rows.map((r) => {
          const rowPrefetched = new Map<string, Record<string, unknown>[]>();
          for (const sub of this.meta.subTables) {
            const included = opts.include!.some((name) => name === sub.fieldName);
            if (!included) continue;
            const byOwner = prefetchedBySub.get(sub.tableName);
            const key = r[pk];
            const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
            rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
          }
          return this._wrapNoSubs(this._hydrateOne(r, opts.include, opts.select, rowPrefetched));
        });
        traceEnd();
        this._emit("findMany", { options: opts, result: results });
        return results;
      }
      // Fast path: no include → skip sub-table hydration entirely
      const results = rows.map((r) => this._wrapNoSubs(hydrateRow(r, this.meta, EMPTY_MAP, this._codecs, opts.select, opts.include)));
      traceEnd();
      this._emit("findMany", { options: opts, result: results });
      return results;
    });
  }

  /**
   * Find many with total count - useful for pagination.
   * Legacy object-based API - use `findPage()` chain API for new code.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const page = orm.users.O_findPage({
   *   where: { status: { eq: "active" } },
   *   limit: 10,
   *   offset: 0,
   * });
   * ```
   */
  O_findPage<const S extends readonly SelectableKeys<TQuery>[], const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S; include: I }): PageResult<SelectShape<TQuery, S> & { [K in I[number]]: SubTableItem<TQuery, K>[] }>;
  O_findPage<const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { include: I }): PageResult<Entity<Infer<TQuery>, Mat, TS> & { [K in I[number]]: SubTableItem<TQuery, K>[] }>;
  O_findPage<const S extends readonly SelectableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S }): PageResult<SelectShape<TQuery, S>>;
  O_findPage(opts?: FindOptions<TQuery>): PageResult<Entity<Infer<TQuery>, Mat, TS>>;
  O_findPage(opts: FindOptions<TQuery> = {}): PageResult<Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TQuery>]>> {
    return withTrace("repository.findPage", { table: this.tableName }, () => {
      const resolvedOpts = opts.include ? this._ensureSelectPk(opts) : opts;
      const { countSql, countParams } = buildSelect(
        this.tableName,
        resolvedOpts,
        this.descriptor.softDelete?.column,
        this.meta
      );

      const rows = this._fetchRows(resolvedOpts, "findPage");

      const include = resolvedOpts.include;
      const pk = this.descriptor.primaryKey.name;

      if (include && include.length > 0) {
        // Batch-fetch sub-table rows (same as O_findMany pattern)
        const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");
        const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
        for (const sub of this.meta.subTables) {
          const inc = include.some((name) => name === sub.fieldName);
          if (!inc || pkValues.length === 0) continue;
          const ph = pkValues.map(() => "?").join(", ");
          const subRows = this._executor.all<Record<string, unknown>>(
            `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" IN (${ph}) ORDER BY "_index" ASC`,
            pkValues,
            "findPage"
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
            const inc = include.some((name) => name === sub.fieldName);
            if (!inc) continue;
            const byOwner = prefetchedBySub.get(sub.tableName);
            const key = r[pk];
            const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
            rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
          }
          return this._wrapNoSubs(this._hydrateOne(r, include, resolvedOpts.select, rowPrefetched));
        });

        const countRow = this._executor.get<{ _count: number }>(countSql, countParams, "count");
        const result = {
          data: results,
          total: (countRow ?? { _count: 0 })._count,
          limit: resolvedOpts.limit ?? results.length,
          offset: resolvedOpts.offset ?? 0,
        };
        this._emit("findPage", { options: opts, result });
        return result;
      }

      // Fast path: no include → hydrate without sub-table fetching
      const results = rows.map((r) => this._wrapNoSubs(hydrateRow(r, this.meta, EMPTY_MAP, this._codecs, resolvedOpts.select)));

      const countRow = this._executor.get<{ _count: number }>(countSql, countParams, "count");
      const result = {
        data: results,
        total: (countRow ?? { _count: 0 })._count,
        limit: resolvedOpts.limit ?? results.length,
        offset: resolvedOpts.offset ?? 0,
      };
      this._emit("findPage", { options: opts, result });
      return result;
    });
  }

  /**
   * Cursor-based pagination (seek method). Avoids OFFSET degradation on
   * large tables by using a boundary value from the previous page.
   * Legacy object-based API - use `findCursorPage()` chain API for new code.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const page = orm.orders.O_findCursorPage({
   *   orderBy: { column: "DocumentDate", direction: "DESC" },
   *   limit: 25,
   * });
   * ```
   */
  O_findCursorPage(opts: {
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

      let results = rows.map((r) => this._wrapNoSubs(this._hydrateOne(r)));
      if (opts.cursor?.direction === "prev") {
        results.reverse();
      }

      const nextCursor: Cursor | null = results.length === limit
        ? { column: opts.orderBy.column, value: cursorValue(results[results.length - 1] as Record<string, unknown>, opts.orderBy.column) }
        : null;

      const prevCursor: Cursor | null = results.length > 0
        ? { column: opts.orderBy.column, value: cursorValue(results[0] as Record<string, unknown>, opts.orderBy.column) }
        : null;

      const result = { data: results, nextCursor, prevCursor };
      this._emit("findCursorPage", { options: opts, result });
      return result;
    });
  }

  /**
   * Find a single record matching the given filters.
   * Legacy object-based API - use `findOne()` chain API for new code.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const admin = orm.users.O_findOne({
   *   where: { role: { eq: "admin" } },
   * });
   * ```
   */
  O_findOne<const S extends readonly SelectableKeys<TQuery>[], const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S; include: I }): (SelectShape<TQuery, S> & { [K in I[number]]: SubTableItem<TQuery, K>[] }) | null;
  O_findOne<const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { include: I }): (Entity<Infer<TQuery>, Mat, TS> & { [K in I[number]]: SubTableItem<TQuery, K>[] }) | null;
  O_findOne<const S extends readonly SelectableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S }): (SelectShape<TQuery, S>) | null;
  O_findOne(opts?: FindOptions<TQuery>): Entity<Infer<TQuery>, Mat, TS> | null;
  O_findOne(opts: FindOptions<TQuery> = {}): (Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TWrite>]>) | null {
    return withTrace("repository.findOne", { table: this.tableName }, () => {
      traceBegin("repo.findOne.fetchRow");
      const resolvedOpts = opts.include ? this._ensureSelectPk(opts) : opts;
      const rows = this._fetchRows({ ...resolvedOpts, limit: 1 }, "findOne");
      const row = rows.length > 0 ? rows[0]! : null;
      traceEnd({ found: !!row });

      if (!row) {
        this._emit("findOne", { options: opts, result: null });
        return null;
      }

      if (opts.include && opts.include.length > 0) {
        const result = this._wrapNoSubs(this._hydrateOne(row, opts.include, opts.select));
        this._emit("findOne", { options: opts, result });
        return result;
      }

      const result = this._wrapNoSubs(hydrateRow(row, this.meta, EMPTY_MAP, this._codecs, opts.select, opts.include));
      this._emit("findOne", { options: opts, result });
      return result;
    });
  }

  /**
   * Iterate over records matching the given filters, yielding one row at a time.
   * Legacy object-based API - use `iterate()` chain API for new code.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * for (const user of orm.users.O_iterate({ where: { active: { eq: true } } })) {
   *   console.log(user.name);
   * }
   * ```
   */
  O_iterate<const S extends readonly SelectableKeys<TQuery>[], const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S; include: I }): Generator<SelectShape<TQuery, S> & { [K in I[number]]: SubTableItem<TQuery, K>[] }>;
  O_iterate<const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { include: I }): Generator<Entity<Infer<TQuery>, Mat, TS> & { [K in I[number]]: SubTableItem<TQuery, K>[] }>;
  O_iterate<const S extends readonly SelectableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S }): Generator<SelectShape<TQuery, S>>;
  O_iterate(opts?: FindOptions<TQuery>): Generator<Entity<Infer<TQuery>, Mat, TS>>;
  *O_iterate(opts: FindOptions<TQuery> = {}): Generator<Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TWrite>]>> {
    return yield* withTrace("repository.iterate", { table: this.tableName }, () => this._iterateImpl(opts));
  }

  private *_iterateImpl(opts: FindOptions<TQuery>): Generator<Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TWrite>]>> {
    const resolvedOpts = opts.include ? this._ensureSelectPk(opts) : opts;
    const { sql, params } = buildSelectSql(this.tableName, resolvedOpts, this.descriptor.softDelete?.column, this.meta);
    const gen = this._executor.iterate<Record<string, unknown>>(sql, params, "iterate");

    if (!opts.include || opts.include.length === 0) {
      for (const row of gen) {
        yield this._wrapNoSubs(this._hydrateOne(row, undefined, opts.select));
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
      yield this._wrapNoSubs(this._hydrateOne(row, include, select, rowPrefetched));
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
    const allSubs = this.meta.subTables.map((s) => s.fieldName) as SubTableKeys<TQuery>[];
    const resolvedOpts = { ...opts, include: allSubs, limit: opts.limit ?? 1000 };
    const rows = this._fetchRows(resolvedOpts, "findMany");
    const pk = this.descriptor.primaryKey.name;
    const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");
    const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
    for (const sub of this.meta.subTables) {
      if (pkValues.length === 0) continue;
      const ph = pkValues.map(() => "?").join(", ");
      const subRows = this._executor.all<Record<string, unknown>>(
        `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" IN (${ph}) ORDER BY "_index" ASC`,
        pkValues, "findMany"
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
    const entities = rows.map((r) => {
      const rowPrefetched = new Map<string, Record<string, unknown>[]>();
      for (const sub of this.meta.subTables) {
        const byOwner = prefetchedBySub.get(sub.tableName);
        const key = r[pk];
        const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
        rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
      }
      return this._wrap(this._hydrateOne(r, allSubs, opts.select, rowPrefetched));
    });
    if (!this._materializeMany) return entities;
    const materialized = this._materializeMany(entities as Record<string, unknown>[]);
    if (this._entityProto) {
      for (const row of materialized) {
        if (Object.getPrototypeOf(row) !== this._entityProto) {
          Object.setPrototypeOf(row, this._entityProto);
        }
      }
    }
    return materialized as Entity<Infer<TQuery>, Mat, TS>[];
  }

  // --- Count -----------------------------------------------------------------

  /**
   * Count records matching the given filters.
   * Legacy object-based API - use `count()` chain API for new code.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const total = orm.users.O_count();
   * const adults = orm.users.O_count({ age: { gte: 18 } });
   * ```
   */
  O_count(where?: WhereClause<TQuery>): number {
    return withTrace("repository.count", { table: this.tableName }, () => {
      traceBegin("repo.count.buildWhere");
      const { sql, params } = buildWhere(where, this.descriptor.softDelete?.column, this.meta);
      traceEnd();
      traceBegin("repo.count.exec");
      const fullSql = `SELECT COUNT(*) as "_count" FROM "${this.tableName}" ${sql}`.trim();
      const row = this._executor.get<{ _count: number }>(
        fullSql,
        params,
        "count"
      );
      traceEnd();
      const result = (row ?? { _count: 0 })._count;
      this._emit("count", { where, result });
      return result;
    });
  }

  /**
   * Run aggregate queries (sum, count, avg, min, max) with optional
   * grouping and filtering.
   * Legacy object-based API - use `aggregate()` chain API for new code.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * orm.orders.O_aggregate({
   *   aggregations: { total: { sum: "amount" } },
   * });
   * ```
   */
  O_aggregate<
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
   * Legacy object-based API - use `windowQuery()` chain API for new code.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * orm.orders.O_windowQuery({
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
  O_windowQuery<const W extends Record<string, import("./types.ts").WindowFunction<TQuery>>>(
    opts: WindowQueryOptions<TQuery> & { select: W }
  ): WindowResult<TQuery, W> {
    return withTrace("repository.windowQuery", { table: this.tableName }, () => {
      const { sql, params } = buildWindowSql(this.tableName, opts, this.descriptor.softDelete?.column, this.meta);
      const rows = this._executor.all<WindowResult<TQuery, W>[number]>(sql, params, "windowQuery");
      this._emit("windowQuery", { options: opts, result: rows });
      return rows;
    });
  }

  // --- Async read methods (require asyncReaderPool in createORM) -------------

  /**
   * Async variant of O_findMany - executes on the worker thread pool.
   */
  O_findManyAsync<const S extends readonly SelectableKeys<TQuery>[], const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S; include: I }): Promise<(SelectShape<TQuery, S> & { [K in I[number]]: SubTableItem<TQuery, K>[] })[]>;
  O_findManyAsync<const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { include: I }): Promise<(Entity<Infer<TQuery>, Mat, TS> & { [K in I[number]]: SubTableItem<TQuery, K>[] })[]>;
  O_findManyAsync<const S extends readonly SelectableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S }): Promise<(SelectShape<TQuery, S>)[]>;
  O_findManyAsync(opts?: FindOptions<TQuery>): Promise<Entity<Infer<TQuery>, Mat, TS>[]>;
  async O_findManyAsync(opts: FindOptions<TQuery> = {}): Promise<(Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TQuery>]>)[]> {
    if (!this._readScheduler) {
      return Promise.resolve().then(() => this.O_findMany(opts));
    }
    const resolvedOpts = {
      ...(opts.include ? this._ensureSelectPk(opts) : opts),
      limit: opts.limit ?? 1000,
    };
    const { sql, params } = buildSelect(this.tableName, resolvedOpts, this.descriptor.softDelete?.column, this.meta);
    const rows = await this._readScheduler.execWithCols(sql, params, this._allColumnNames);

    const pk = this.descriptor.primaryKey.name;
    const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");
    const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
    if (opts.include && opts.include.length > 0) {
      for (const sub of this.meta.subTables) {
        const included = opts.include.some((name) => name === sub.fieldName);
        if (!included) continue;
        if (pkValues.length === 0) continue;
        const ph = pkValues.map(() => "?").join(", ");
        const subRows = await this._readScheduler.exec<Record<string, unknown>[]>(
          `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" IN (${ph}) ORDER BY "_index" ASC`,
          pkValues
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
    }

    let results: (Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TQuery>]>)[];
    if (opts.include && opts.include.length > 0) {
      results = rows.map((r) => {
        const rowPrefetched = new Map<string, Record<string, unknown>[]>();
        for (const sub of this.meta.subTables) {
          const included = opts.include!.some((name) => name === sub.fieldName);
          if (!included) continue;
          const byOwner = prefetchedBySub.get(sub.tableName);
          const key = r[pk];
          const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
          rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
        }
        return this._wrapNoSubs(this._hydrateOne(r, opts.include, opts.select, rowPrefetched));
      });
    } else {
      results = rows.map((r) => this._wrapNoSubs(hydrateRow(r, this.meta, EMPTY_MAP, this._codecs, opts.select, opts.include)));
    }

    this._emit("findMany", { options: opts, result: results });
    return results;
  }

  /**
   * Async variant of O_findOne - executes on the worker thread pool.
   */
  O_findOneAsync<const S extends readonly SelectableKeys<TQuery>[], const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S; include: I }): Promise<(SelectShape<TQuery, S> & { [K in I[number]]: SubTableItem<TQuery, K>[] }) | null>;
  O_findOneAsync<const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { include: I }): Promise<(Entity<Infer<TQuery>, Mat, TS> & { [K in I[number]]: SubTableItem<TQuery, K>[] }) | null>;
  O_findOneAsync<const S extends readonly SelectableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S }): Promise<(SelectShape<TQuery, S>) | null>;
  O_findOneAsync(opts?: FindOptions<TQuery>): Promise<Entity<Infer<TQuery>, Mat, TS> | null>;
  async O_findOneAsync(opts: FindOptions<TQuery> = {}): Promise<(Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TWrite>]>) | null> {
    if (!this._readScheduler) {
      return Promise.resolve().then(() => this.O_findOne(opts));
    }
    const resolvedOpts = opts.select && opts.include ? this._ensureSelectPk(opts) : opts;
    const { sql, params } = buildSelect(this.tableName, { ...resolvedOpts, limit: 1 }, this.descriptor.softDelete?.column, this.meta);
    const rows = await this._readScheduler.execWithCols(sql, params, this._allColumnNames);
    const row = rows[0] ?? null;
    const result = row ? this._wrapNoSubs(this._hydrateOne(row, opts.include, opts.select)) : null;
    this._emit("findOne", { options: opts, result });
    return result;
  }

  /**
   * Async variant of O_findPage - executes on the worker thread pool.
   */
  O_findPageAsync<const S extends readonly SelectableKeys<TQuery>[], const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S; include: I }): Promise<PageResult<SelectShape<TQuery, S> & { [K in I[number]]: SubTableItem<TQuery, K>[] }>>;
  O_findPageAsync<const I extends readonly SubTableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { include: I }): Promise<PageResult<Entity<Infer<TQuery>, Mat, TS> & { [K in I[number]]: SubTableItem<TQuery, K>[] }>>;
  O_findPageAsync<const S extends readonly SelectableKeys<TQuery>[]>(opts: FindOptions<TQuery> & { select: S }): Promise<PageResult<SelectShape<TQuery, S>>>;
  O_findPageAsync(opts?: FindOptions<TQuery>): Promise<PageResult<Entity<Infer<TQuery>, Mat, TS>>>;
  async O_findPageAsync(opts: FindOptions<TQuery> = {}): Promise<PageResult<Entity<Infer<TQuery>, Mat, TS> | SelectShape<TQuery, [ScalarKeys<TQuery>]>>> {
    if (!this._readScheduler) {
      return Promise.resolve().then(() => this.O_findPage(opts));
    }
    const resolvedOpts = opts.include ? this._ensureSelectPk(opts) : opts;
    const { sql, params, countSql, countParams } = buildSelect(this.tableName, resolvedOpts, this.descriptor.softDelete?.column, this.meta);

    const [rows, countRows] = await Promise.all([
      this._readScheduler.execWithCols(sql, params, this._allColumnNames),
      this._readScheduler.exec<{ _count: number }[]>(countSql, countParams),
    ]);

    const include = resolvedOpts.include;
    const pk = this.descriptor.primaryKey.name;

    if (include && include.length > 0) {
      // Batch-prefetch sub-table rows (matching sync O_findPage pattern)
      const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");
      const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
      for (const sub of this.meta.subTables) {
        const inc = include.some((name) => name === sub.fieldName);
        if (!inc || pkValues.length === 0) continue;
        const ph = pkValues.map(() => "?").join(", ");
        const subRows = await this._readScheduler.exec<Record<string, unknown>[]>(
          `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" IN (${ph}) ORDER BY "_index" ASC`,
          pkValues
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

      const hydrated = rows.map((r) => {
        const rowPrefetched = new Map<string, Record<string, unknown>[]>();
        for (const sub of this.meta.subTables) {
          const inc = include.some((name) => name === sub.fieldName);
          if (!inc) continue;
          const byOwner = prefetchedBySub.get(sub.tableName);
          const key = r[pk];
          const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
          rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
        }
        return this._wrapNoSubs(this._hydrateOne(r, include, resolvedOpts.select, rowPrefetched));
      });

      const total = (countRows[0] ?? { _count: 0 })._count;
      const result = {
        data: hydrated,
        total,
        limit: opts.limit ?? hydrated.length,
        offset: opts.offset ?? 0,
      };
      this._emit("findPage", { options: opts, result });
      return result;
    }

    // Fast path: no include → hydrate without sub-table fetching
    const hydrated = rows.map((r) => this._wrapNoSubs(hydrateRow(r, this.meta, EMPTY_MAP, this._codecs, resolvedOpts.select)));
    const total = (countRows[0] ?? { _count: 0 })._count;

    const result = {
      data: hydrated,
      total,
      limit: opts.limit ?? hydrated.length,
      offset: opts.offset ?? 0,
    };
    this._emit("findPage", { options: opts, result });
    return result;
  }

  /**
   * Async variant of O_findCursorPage - executes on the worker thread pool.
   */
  async O_findCursorPageAsync(opts: {
    where?: WhereClause<TQuery>;
    orderBy: OrderByClause<TQuery>;
    cursor?: CursorInput;
    limit?: number;
  }): Promise<CursorPageResult<Entity<Infer<TQuery>, Mat, TS>>> {
    if (!this._readScheduler) {
      return Promise.resolve().then(() => this.O_findCursorPage(opts));
    }
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

    const rows = await this._readScheduler.execWithCols(sql, params, this._allColumnNames);

    let results = rows.map((r) => this._wrapNoSubs(this._hydrateOne(r)));
    if (opts.cursor?.direction === "prev") {
      results.reverse();
    }

    const nextCursor: Cursor | null = results.length === limit
      ? { column: opts.orderBy.column, value: cursorValue(results[results.length - 1] as Record<string, unknown>, opts.orderBy.column) }
      : null;
    const prevCursor: Cursor | null = results.length > 0
      ? { column: opts.orderBy.column, value: cursorValue(results[0] as Record<string, unknown>, opts.orderBy.column) }
      : null;

    const result = { data: results, nextCursor, prevCursor };
    this._emit("findCursorPage", { options: opts, result });
    return result;
  }

  /**
   * Async variant of O_count - executes on the worker thread pool.
   */
  async O_countAsync(where?: WhereClause<TQuery>): Promise<number> {
    if (!this._readScheduler) {
      return Promise.resolve().then(() => this.O_count(where));
    }
    const { sql, params } = buildWhere(where, this.descriptor.softDelete?.column, this.meta);
    const fullSql = `SELECT COUNT(*) as "_count" FROM "${this.tableName}" ${sql}`.trim();
    const rows = await this._readScheduler.exec<{ _count: number }[]>(fullSql, params);
    const result = (rows[0] ?? { _count: 0 })._count;
    this._emit("count", { where, result });
    return result;
  }

  /**
   * Async variant of O_aggregate - executes on the worker thread pool.
   */
  async O_aggregateAsync<
    const A extends Record<string, AggregationOp<TQuery>>,
    const G extends readonly (ScalarKeys<TQuery> | import("./types.ts").ScalarJsonPath<TQuery>)[] | undefined = undefined
  >(opts: AggregateOptions<TQuery, A> & { groupBy?: G }): Promise<AggregateResult<TQuery, A, G>> {
    if (!this._readScheduler) {
      return Promise.resolve().then(() => this.O_aggregate(opts));
    }
    const { sql, params } = buildAggregateSql(this.tableName, opts, this.descriptor.softDelete?.column, this.meta);
    const rows = await this._readScheduler.exec<AggregateResult<TQuery, A, G>>(sql, params);
    this._emit("aggregate", { options: opts, result: rows });
    return rows;
  }

  /**
   * Async variant of O_windowQuery - executes on the worker thread pool.
   */
  async O_windowQueryAsync<const W extends Record<string, import("./types.ts").WindowFunction<TQuery>>>(
    opts: WindowQueryOptions<TQuery> & { select: W }
  ): Promise<WindowResult<TQuery, W>> {
    if (!this._readScheduler) {
      return Promise.resolve().then(() => this.O_windowQuery(opts));
    }
    const { sql, params } = buildWindowSql(this.tableName, opts, this.descriptor.softDelete?.column, this.meta);
    const rows = await this._readScheduler.exec<WindowResult<TQuery, W>>(sql, params);
    this._emit("windowQuery", { options: opts, result: rows });
    return rows;
  }

  /**
   * Async variant of findById - executes on the worker thread pool.
   */
  async findByIdAsync(id: Infer<TQuery>[PK]): Promise<Entity<Infer<TQuery>, Mat, TS> | null> {
    if (!this._readScheduler) {
      return Promise.resolve().then(() => this.findById(id));
    }
    const pk = this.descriptor.primaryKey.name;
    const sql = this.descriptor.softDelete
      ? `SELECT * FROM "${this.tableName}" WHERE "${pk}" = ? AND "${this.descriptor.softDelete.column}" IS NULL LIMIT 1`
      : `SELECT * FROM "${this.tableName}" WHERE "${pk}" = ? LIMIT 1`;
    const rows = await this._readScheduler.execWithCols(sql, [id as string | number | bigint | null], this._allColumnNames);
    const row = rows[0] ?? null;
    const result = row ? this._wrap(this._hydrateOne(row)) : null;
    this._emit("findById", { id, result });
    return result;
  }

  /**
   * Async variant of findManyMaterialized - executes on the worker thread pool.
   */
  async findManyMaterializedAsync(opts: FindOptions<TQuery> = {}): Promise<Entity<Infer<TQuery>, Mat, TS>[]> {
    if (!this._readScheduler) {
      return Promise.resolve().then(() => this.findManyMaterialized(opts));
    }
    const allSubs = this.meta.subTables.map((s) => s.fieldName) as SubTableKeys<TQuery>[];
    const resolvedOpts = { ...opts, include: allSubs, limit: opts.limit ?? 1000 };
    const { sql, params } = buildSelect(this.tableName, resolvedOpts, this.descriptor.softDelete?.column, this.meta);
    const rows = await this._readScheduler!.exec<Record<string, unknown>[]>(sql, params);
    const pk = this.descriptor.primaryKey.name;
    const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");
    const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
    for (const sub of this.meta.subTables) {
      if (pkValues.length === 0) continue;
      const ph = pkValues.map(() => "?").join(", ");
      const subRows = await this._readScheduler!.exec<Record<string, unknown>[]>(
        `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" IN (${ph}) ORDER BY "_index" ASC`,
        pkValues
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
    const entities = rows.map((r) => {
      const rowPrefetched = new Map<string, Record<string, unknown>[]>();
      for (const sub of this.meta.subTables) {
        const byOwner = prefetchedBySub.get(sub.tableName);
        const key = r[pk];
        const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
        rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
      }
      return this._wrap(this._hydrateOne(r, allSubs, opts.select, rowPrefetched));
    });
    if (!this._materializeMany) return entities;
    const materialized = this._materializeMany(entities as Record<string, unknown>[]);
    if (this._entityProto) {
      for (const row of materialized) {
        if (Object.getPrototypeOf(row) !== this._entityProto) {
          Object.setPrototypeOf(row, this._entityProto);
        }
      }
    }
    return materialized as Entity<Infer<TQuery>, Mat, TS>[];
  }

  /**
   * Async variant of raw - executes on the worker thread pool.
   */
  async rawAsync<R = import("./types.ts").DBRow>(sql: string, ...params: import("./types.ts").DBValue[]): Promise<R[]> {
    if (!this._readScheduler) {
      return Promise.resolve().then(() => this.raw<R>(sql, ...params));
    }
    const result = await this._readScheduler.exec<R[]>(sql, params.map(toBinding));
    return result ?? [];
  }

  // --- Chain API builder entry points ----------------------------------------

  /**
   * Start a chain filter query that returns many records.
   *
   * @group Reading - Chain API
   *
   * @example
   * ```ts
   * const adults = orm.users
   *   .findMany()
   *   .greaterThanOrEqual("age", 18)
   *   .equals("active", true)
   *   .orderBy("createdAt", "DESC")
   *   .limit(10)
   *   .exec();
   * ```
   */
  findMany(): FilterBuilder<TQuery, Entity<Infer<TQuery>, Mat, TS>[]> {
    const tableName = this.tableName;
    const meta = this.meta;
    const queryExecutor = this._executor;
    const readScheduler = this._readScheduler;
    const softDeleteCol = this.descriptor.softDelete?.column;
    const pk = this.descriptor.primaryKey.name;
    const subTables = this.meta.subTables;
    const wrap = this._wrapNoSubs.bind(this);
    const hydrateOne = this._hydrateOne.bind(this);
    const emit = this._emit.bind(this);

    const executor = (state: InternalBuilderState): Entity<Infer<TQuery>, Mat, TS>[] => {
      const { sql: whereSql, params: whereParams } = buildWhereFromNodes(
        state.nodes,
        state.includeDeleted ? undefined : softDeleteCol,
        meta
      );

      let selectCols = "*";
      // Ensure PK is in select columns when include is requested (needed for sub-table batch fetching)
      if (state.include && state.include.length > 0 && state.select && !state.select.includes(pk)) {
        state.select = [...state.select, pk];
      }
      if (state.select && state.select.length > 0) {
        selectCols = state.select.map((c) => `"${c}"`).join(", ");
      }

      const distinctPrefix = state.distinct ? "DISTINCT " : "";
      const orderSql = state.orderBy.length > 0
        ? "ORDER BY " + state.orderBy.map((o) => `${resolveOrderByColumn(o.column, meta)} ${o.direction}`).join(", ")
        : "";
      const limitOffsetParts: string[] = [];
      const limitOffsetParams: SQLQueryBindings[] = [];
      const effectiveLimit = state.limit ?? 1000;
      limitOffsetParts.push("LIMIT ?");
      limitOffsetParams.push(effectiveLimit);
      if (state.offset !== undefined) {
        limitOffsetParts.push("OFFSET ?");
        limitOffsetParams.push(state.offset);
      }

      const sql = [
        `SELECT ${distinctPrefix}${selectCols} FROM "${tableName}"`,
        whereSql,
        orderSql,
        limitOffsetParts.join(" "),
      ].filter(Boolean).join(" ");

      const rows = queryExecutor.all<Record<string, unknown>>(sql, [...whereParams, ...limitOffsetParams], "findMany");

      const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");

      const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
      if (state.include && state.include.length > 0) {
        for (const sub of subTables) {
          const included = state.include.some((name) => name === sub.fieldName);
          if (!included) continue;
          if (pkValues.length === 0) continue;
          const ph = pkValues.map(() => "?").join(", ");
          const subRows = queryExecutor.all<Record<string, unknown>>(
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
      }

      const results = state.include && state.include.length > 0
        ? rows.map((r) => {
          const rowPrefetched = new Map<string, Record<string, unknown>[]>();
          for (const sub of subTables) {
            const included = state.include!.some((name) => name === sub.fieldName);
            if (!included) continue;
            const byOwner = prefetchedBySub.get(sub.tableName);
            const key = r[pk];
            const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
            rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
          }
          return wrap(hydrateOne(r, state.include, state.select, rowPrefetched));
        })
        : rows.map((r) => wrap(hydrateRow(r, meta, EMPTY_MAP, this._codecs, state.select, state.include)));

      emit("findMany", { options: {}, result: results });
      return results;
    };

    const fb = new FilterBuilder<TQuery, Entity<Infer<TQuery>, Mat, TS>[]>(executor);

    if (readScheduler) {
      const asyncExecutor = async (state: InternalBuilderState): Promise<Entity<Infer<TQuery>, Mat, TS>[]> => {
        const { sql: whereSql, params: whereParams } = buildWhereFromNodes(
          state.nodes,
          state.includeDeleted ? undefined : softDeleteCol,
          meta
        );

        let selectCols = "*";
        // Ensure PK is in select columns when include is requested (needed for sub-table batch fetching)
        if (state.include && state.include.length > 0 && state.select && !state.select.includes(pk)) {
          state.select = [...state.select, pk];
        }
        if (state.select && state.select.length > 0) {
          selectCols = state.select.map((c) => `"${c}"`).join(", ");
        }

        const distinctPrefix = state.distinct ? "DISTINCT " : "";
        const orderSql = state.orderBy.length > 0
          ? "ORDER BY " + state.orderBy.map((o) => `${resolveOrderByColumn(o.column, meta)} ${o.direction}`).join(", ")
          : "";
        const limitOffsetParts: string[] = [];
        const limitOffsetParams: SQLQueryBindings[] = [];
        const effectiveLimit = state.limit ?? 1000;
        limitOffsetParts.push("LIMIT ?");
        limitOffsetParams.push(effectiveLimit);
        if (state.offset !== undefined) {
          limitOffsetParts.push("OFFSET ?");
          limitOffsetParams.push(state.offset);
        }

        const sql = [
          `SELECT ${distinctPrefix}${selectCols} FROM "${tableName}"`,
          whereSql,
          orderSql,
          limitOffsetParts.join(" "),
        ].filter(Boolean).join(" ");

        const rows = selectCols === "*"
          ? await readScheduler.execWithCols(sql, [...whereParams, ...limitOffsetParams], this._allColumnNames)
          : await readScheduler.exec<Record<string, unknown>[]>(sql, [...whereParams, ...limitOffsetParams]);

        const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");

        const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
        if (state.include && state.include.length > 0) {
          for (const sub of subTables) {
            const included = state.include.some((name) => name === sub.fieldName);
            if (!included) continue;
            if (pkValues.length === 0) continue;
            const ph = pkValues.map(() => "?").join(", ");
            const subRows = await readScheduler.exec<Record<string, unknown>[]>(
              `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" IN (${ph}) ORDER BY "_index" ASC`,
              pkValues
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
        }

        const results = state.include && state.include.length > 0
          ? rows.map((r) => {
            const rowPrefetched = new Map<string, Record<string, unknown>[]>();
            for (const sub of subTables) {
              const included = state.include!.some((name) => name === sub.fieldName);
              if (!included) continue;
              const byOwner = prefetchedBySub.get(sub.tableName);
              const key = r[pk];
              const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
              rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
            }
            return wrap(hydrateOne(r, state.include, state.select, rowPrefetched));
          })
          : rows.map((r) => wrap(hydrateRow(r, meta, EMPTY_MAP, this._codecs, state.select, state.include)));

        emit("findMany", { options: {}, result: results });
        return results;
      };
      return new FilterBuilder<TQuery, Entity<Infer<TQuery>, Mat, TS>[]>(executor, asyncExecutor);
    }

    return fb;
  }

  /**
   * Start a chain filter query that returns a single record.
   *
   * @group Reading - Chain API
   *
   * @example
   * ```ts
   * const admin = orm.users
   *   .findOne()
   *   .equals("role", "admin")
   *   .exec();
   * ```
   */
  findOne(): FilterBuilder<TQuery, Entity<Infer<TQuery>, Mat, TS> | null> {
    const tableName = this.tableName;
    const meta = this.meta;
    const queryExecutor = this._executor;
    const readScheduler = this._readScheduler;
    const softDeleteCol = this.descriptor.softDelete?.column;
    const pk = this.descriptor.primaryKey.name;
    const wrap = this._wrapNoSubs.bind(this);
    const hydrateOne = this._hydrateOne.bind(this);
    const emit = this._emit.bind(this);

    const executor = (state: InternalBuilderState): Entity<Infer<TQuery>, Mat, TS> | null => {
      const { sql: whereSql, params: whereParams } = buildWhereFromNodes(
        state.nodes,
        state.includeDeleted ? undefined : softDeleteCol,
        meta
      );

      let selectCols = "*";
      // Ensure PK is in select columns when include is requested (needed for sub-table batch fetching)
      if (state.include && state.include.length > 0 && state.select && !state.select.includes(pk)) {
        state.select = [...state.select, pk];
      }
      if (state.select && state.select.length > 0) {
        selectCols = state.select.map((c) => `"${c}"`).join(", ");
      }

      const orderSql = state.orderBy.length > 0
        ? "ORDER BY " + state.orderBy.map((o) => `${resolveOrderByColumn(o.column, meta)} ${o.direction}`).join(", ")
        : "";

      const sql = [
        `SELECT ${selectCols} FROM "${tableName}"`,
        whereSql,
        orderSql,
        "LIMIT 1",
      ].filter(Boolean).join(" ");

      const row = queryExecutor.get<Record<string, unknown>>(sql, whereParams, "findOne");

      if (!row) {
        emit("findOne", { options: {}, result: null });
        return null;
      }

      const result = wrap(hydrateOne(row, state.include, state.select));
      emit("findOne", { options: {}, result });
      return result;
    };

    const fb = new FilterBuilder<TQuery, Entity<Infer<TQuery>, Mat, TS> | null>(executor);

    if (readScheduler) {
      const asyncExecutor = async (state: InternalBuilderState): Promise<Entity<Infer<TQuery>, Mat, TS> | null> => {
        const { sql: whereSql, params: whereParams } = buildWhereFromNodes(
          state.nodes,
          state.includeDeleted ? undefined : softDeleteCol,
          meta
        );

        let selectCols = "*";
        // Ensure PK is in select columns when include is requested (needed for sub-table batch fetching)
        if (state.include && state.include.length > 0 && state.select && !state.select.includes(pk)) {
          state.select = [...state.select, pk];
        }
        if (state.select && state.select.length > 0) {
          selectCols = state.select.map((c) => `"${c}"`).join(", ");
        }

        const orderSql = state.orderBy.length > 0
          ? "ORDER BY " + state.orderBy.map((o) => `${resolveOrderByColumn(o.column, meta)} ${o.direction}`).join(", ")
          : "";

        const sql = [
          `SELECT ${selectCols} FROM "${tableName}"`,
          whereSql,
          orderSql,
          "LIMIT 1",
        ].filter(Boolean).join(" ");

        const rows = selectCols === "*"
          ? await readScheduler.execWithCols(sql, whereParams, this._allColumnNames)
          : await readScheduler.exec<Record<string, unknown>[]>(sql, whereParams);
        const row = rows[0] ?? null;

        if (!row) {
          emit("findOne", { options: {}, result: null });
          return null;
        }

        const result = state.include && state.include.length > 0
          ? wrap(hydrateOne(row, state.include, state.select))
          : wrap(hydrateRow(row, meta, EMPTY_MAP, this._codecs, state.select, state.include));
        emit("findOne", { options: {}, result });
        return result;
      };
      return new FilterBuilder<TQuery, Entity<Infer<TQuery>, Mat, TS> | null>(executor, asyncExecutor);
    }

    return fb;
  }

  /**
   * Start a chain count query.
   *
   * @group Reading - Chain API
   *
   * @example
   * ```ts
   * const total = orm.users
   *   .count()
   *   .equals("active", true)
   *   .exec();
   * ```
   */
  count(): FilterBuilder<TQuery, number> {
    const tableName = this.tableName;
    const meta = this.meta;
    const queryExecutor = this._executor;
    const readScheduler = this._readScheduler;
    const softDeleteCol = this.descriptor.softDelete?.column;

    const executor = (state: InternalBuilderState): number => {
      const { sql: whereSql, params } = buildWhereFromNodes(
        state.nodes,
        state.includeDeleted ? undefined : softDeleteCol,
        meta
      );

      const fullSql = `SELECT COUNT(*) as "_count" FROM "${tableName}" ${whereSql}`.trim();
      const row = queryExecutor.get<{ _count: number }>(fullSql, params, "count");
      const result = (row ?? { _count: 0 })._count;
      return result;
    };

    const fb = new FilterBuilder<TQuery, number>(executor);

    if (readScheduler) {
      const asyncExecutor = async (state: InternalBuilderState): Promise<number> => {
        const { sql: whereSql, params } = buildWhereFromNodes(
          state.nodes,
          state.includeDeleted ? undefined : softDeleteCol,
          meta
        );

        const fullSql = `SELECT COUNT(*) as "_count" FROM "${tableName}" ${whereSql}`.trim();
        const rows = await readScheduler.exec<{ _count: number }[]>(fullSql, params);
        const row = rows[0] ?? null;
        const result = (row ?? { _count: 0 })._count;
        return result;
      };
      return new FilterBuilder<TQuery, number>(executor, asyncExecutor);
    }

    return fb;
  }

  /**
   * Start a chain paginated query.
   *
   * @group Reading - Chain API
   *
   * @example
   * ```ts
   * const page = orm.users
   *   .findPage()
   *   .equals("active", true)
   *   .limit(10)
   *   .offset(0)
   *   .exec();
   * ```
   */
  findPage(): FilterBuilder<TQuery, PageResult<Entity<Infer<TQuery>, Mat, TS>>> {
    const tableName = this.tableName;
    const meta = this.meta;
    const queryExecutor = this._executor;
    const readScheduler = this._readScheduler;
    const softDeleteCol = this.descriptor.softDelete?.column;
    const pk = this.descriptor.primaryKey.name;
    const wrap = this._wrapNoSubs.bind(this);
    const hydrateOne = this._hydrateOne.bind(this);

    const executor = (state: InternalBuilderState): PageResult<Entity<Infer<TQuery>, Mat, TS>> => {
      const { sql: whereSql, params: whereParams } = buildWhereFromNodes(
        state.nodes,
        state.includeDeleted ? undefined : softDeleteCol,
        meta
      );

      let selectCols = "*";
      // Ensure PK is in select columns when include is requested (needed for sub-table batch fetching)
      if (state.include && state.include.length > 0 && state.select && !state.select.includes(pk)) {
        state.select = [...state.select, pk];
      }
      if (state.select && state.select.length > 0) {
        selectCols = state.select.map((c) => `"${c}"`).join(", ");
      }

      const orderSql = state.orderBy.length > 0
        ? "ORDER BY " + state.orderBy.map((o) => `${resolveOrderByColumn(o.column, meta)} ${o.direction}`).join(", ")
        : "";
      const limitOffsetParts: string[] = [];
      const limitOffsetParams: SQLQueryBindings[] = [];
      const effectiveLimit = state.limit ?? 1000;
      limitOffsetParts.push("LIMIT ?");
      limitOffsetParams.push(effectiveLimit);
      if (state.offset !== undefined) {
        limitOffsetParts.push("OFFSET ?");
        limitOffsetParams.push(state.offset);
      }

      const sql = [
        `SELECT ${selectCols} FROM "${tableName}"`,
        whereSql,
        orderSql,
        limitOffsetParts.join(" "),
      ].filter(Boolean).join(" ");

      const countSql = `SELECT COUNT(*) as "_count" FROM "${tableName}" ${whereSql}`.trim();

      const rows = queryExecutor.all<Record<string, unknown>>(sql, [...whereParams, ...limitOffsetParams], "findPage");
      const countRow = queryExecutor.get<{ _count: number }>(countSql, whereParams, "count");

      let results: Entity<Infer<TQuery>, Mat, TS>[];

      if (state.include && state.include.length > 0) {
        // Batch-prefetch sub-table rows (matching O_findPage pattern)
        const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");
        const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
        for (const sub of this.meta.subTables) {
          const inc = state.include.some((name) => name === sub.fieldName);
          if (!inc || pkValues.length === 0) continue;
          const ph = pkValues.map(() => "?").join(", ");
          const subRows = queryExecutor.all<Record<string, unknown>>(
            `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" IN (${ph}) ORDER BY "_index" ASC`,
            pkValues,
            "findPage"
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

        results = rows.map((r) => {
          const rowPrefetched = new Map<string, Record<string, unknown>[]>();
          for (const sub of this.meta.subTables) {
            const inc = state.include!.some((name) => name === sub.fieldName);
            if (!inc) continue;
            const byOwner = prefetchedBySub.get(sub.tableName);
            const key = r[pk];
            const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
            rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
          }
          return wrap(hydrateOne(r, state.include, state.select, rowPrefetched));
        });
      } else {
        // Fast path: no include → hydrate without sub-table fetching
        results = rows.map((r) => this._wrapNoSubs(hydrateRow(r, this.meta, EMPTY_MAP, this._codecs, state.select, state.include)));
      }

      return {
        data: results,
        total: (countRow ?? { _count: 0 })._count,
        limit: state.limit ?? rows.length,
        offset: state.offset ?? 0,
      };
    };

    const fb = new FilterBuilder<TQuery, PageResult<Entity<Infer<TQuery>, Mat, TS>>>(executor);

    if (readScheduler) {
      const asyncExecutor = async (state: InternalBuilderState): Promise<PageResult<Entity<Infer<TQuery>, Mat, TS>>> => {
        const { sql: whereSql, params: whereParams } = buildWhereFromNodes(
          state.nodes,
          state.includeDeleted ? undefined : softDeleteCol,
          meta
        );

        let selectCols = "*";
        // Ensure PK is in select columns when include is requested (needed for sub-table batch fetching)
        if (state.include && state.include.length > 0 && state.select && !state.select.includes(pk)) {
          state.select = [...state.select, pk];
        }
        if (state.select && state.select.length > 0) {
          selectCols = state.select.map((c) => `"${c}"`).join(", ");
        }

        const orderSql = state.orderBy.length > 0
          ? "ORDER BY " + state.orderBy.map((o) => `${resolveOrderByColumn(o.column, meta)} ${o.direction}`).join(", ")
          : "";
        const limitOffsetParts: string[] = [];
        const limitOffsetParams: SQLQueryBindings[] = [];
        const effectiveLimit = state.limit ?? 1000;
        limitOffsetParts.push("LIMIT ?");
        limitOffsetParams.push(effectiveLimit);
        if (state.offset !== undefined) {
          limitOffsetParts.push("OFFSET ?");
          limitOffsetParams.push(state.offset);
        }

        const sql = [
          `SELECT ${selectCols} FROM "${tableName}"`,
          whereSql,
          orderSql,
          limitOffsetParts.join(" "),
        ].filter(Boolean).join(" ");

        const countSql = `SELECT COUNT(*) as "_count" FROM "${tableName}" ${whereSql}`.trim();

        const [rows, countRows] = await Promise.all([
          selectCols === "*"
            ? readScheduler.execWithCols(sql, [...whereParams, ...limitOffsetParams], this._allColumnNames)
            : readScheduler.exec<Record<string, unknown>[]>(sql, [...whereParams, ...limitOffsetParams]),
          readScheduler.exec<{ _count: number }[]>(countSql, whereParams),
        ]);

        const countRow = countRows[0] ?? null;

        let results: Entity<Infer<TQuery>, Mat, TS>[];
        if (state.include && state.include.length > 0) {
          // Batch-prefetch sub-table rows
          const pkValues = rows.map((r) => r[pk]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");
          const prefetchedBySub = new Map<string, Map<string | number, Record<string, unknown>[]>>();
          for (const sub of this.meta.subTables) {
            const inc = state.include.some((name) => name === sub.fieldName);
            if (!inc || pkValues.length === 0) continue;
            const ph = pkValues.map(() => "?").join(", ");
            const subRows = await readScheduler.exec<Record<string, unknown>[]>(
              `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" IN (${ph}) ORDER BY "_index" ASC`,
              pkValues
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

          results = rows.map((r) => {
            const rowPrefetched = new Map<string, Record<string, unknown>[]>();
            for (const sub of this.meta.subTables) {
              const inc = state.include!.some((name) => name === sub.fieldName);
              if (!inc) continue;
              const byOwner = prefetchedBySub.get(sub.tableName);
              const key = r[pk];
              const pkVal = typeof key === "string" || typeof key === "number" ? key : undefined;
              rowPrefetched.set(sub.tableName, pkVal !== undefined ? byOwner?.get(pkVal) ?? [] : []);
            }
            return wrap(hydrateOne(r, state.include, state.select, rowPrefetched));
          });
        } else {
          results = rows.map((r) => this._wrapNoSubs(hydrateRow(r, this.meta, EMPTY_MAP, this._codecs, state.select, state.include)));
        }

        return {
          data: results,
          total: (countRow ?? { _count: 0 })._count,
          limit: state.limit ?? rows.length,
          offset: state.offset ?? 0,
        };
      };
      return new FilterBuilder<TQuery, PageResult<Entity<Infer<TQuery>, Mat, TS>>>(executor, asyncExecutor);
    }

    return fb;
  }

  /**
   * Start a chain cursor-paginated query.
   *
   * @group Reading - Chain API
   *
   * @example
   * ```ts
   * const page = orm.orders
   *   .findCursorPage()
   *   .orderBy("id", "ASC")
   *   .limit(25)
   *   .exec();
   * ```
   */
  findCursorPage(): FilterBuilder<TQuery, CursorPageResult<Entity<Infer<TQuery>, Mat, TS>>> {
    const tableName = this.tableName;
    const meta = this.meta;
    const queryExecutor = this._executor;
    const readScheduler = this._readScheduler;
    const softDeleteCol = this.descriptor.softDelete?.column;
    const wrap = this._wrapNoSubs.bind(this);
    const hydrateOne = this._hydrateOne.bind(this);

    const executor = (state: InternalBuilderState): CursorPageResult<Entity<Infer<TQuery>, Mat, TS>> => {
      const { sql: whereSql, params: whereParams } = buildWhereFromNodes(
        state.nodes,
        state.includeDeleted ? undefined : softDeleteCol,
        meta
      );

      const limit = state.limit ?? 25;
      const direction = state.orderBy[0]?.direction ?? "ASC";
      const colRef = state.orderBy.length > 0
        ? resolveOrderByColumn(state.orderBy[0]!.column, meta)
        : `"${this.descriptor.primaryKey.name}"`;

      let sql = `SELECT * FROM "${tableName}"`;
      const params: SQLQueryBindings[] = [...whereParams];

      if (whereSql) sql += ` ${whereSql}`;
      sql += ` ORDER BY ${colRef} ${direction} LIMIT ${limit}`;

      const rows = queryExecutor.all<Record<string, unknown>>(sql, params, "findCursorPage");

      let results = rows.map((r) => wrap(hydrateOne(r)));

      const cursorCol = state.orderBy[0]?.column ?? this.descriptor.primaryKey.name;
      const nextCursor: Cursor | null = results.length === limit
        ? { column: cursorCol, value: cursorValue(results[results.length - 1] as Record<string, unknown>, cursorCol) }
        : null;
      const prevCursor: Cursor | null = results.length > 0
        ? { column: cursorCol, value: cursorValue(results[0] as Record<string, unknown>, cursorCol) }
        : null;

      return { data: results, nextCursor, prevCursor };
    };

    const fb = new FilterBuilder<TQuery, CursorPageResult<Entity<Infer<TQuery>, Mat, TS>>>(executor);

    if (readScheduler) {
      const asyncExecutor = async (state: InternalBuilderState): Promise<CursorPageResult<Entity<Infer<TQuery>, Mat, TS>>> => {
        const { sql: whereSql, params: whereParams } = buildWhereFromNodes(
          state.nodes,
          state.includeDeleted ? undefined : softDeleteCol,
          meta
        );

        const limit = state.limit ?? 25;
        const direction = state.orderBy[0]?.direction ?? "ASC";
        const colRef = state.orderBy.length > 0
          ? resolveOrderByColumn(state.orderBy[0]!.column, meta)
          : `"${this.descriptor.primaryKey.name}"`;

        let sql = `SELECT * FROM "${tableName}"`;
        const params: SQLQueryBindings[] = [...whereParams];

        if (whereSql) sql += ` ${whereSql}`;
        sql += ` ORDER BY ${colRef} ${direction} LIMIT ${limit}`;

        const rows = await readScheduler.execWithCols(sql, params, this._allColumnNames);

        let results = rows.map((r) => wrap(hydrateOne(r)));

        const cursorCol = state.orderBy[0]?.column ?? this.descriptor.primaryKey.name;
        const nextCursor: Cursor | null = results.length === limit
          ? { column: cursorCol, value: cursorValue(results[results.length - 1] as Record<string, unknown>, cursorCol) }
          : null;
        const prevCursor: Cursor | null = results.length > 0
          ? { column: cursorCol, value: cursorValue(results[0] as Record<string, unknown>, cursorCol) }
          : null;

        return { data: results, nextCursor, prevCursor };
      };
      return new FilterBuilder<TQuery, CursorPageResult<Entity<Infer<TQuery>, Mat, TS>>>(executor, asyncExecutor);
    }

    return fb;
  }

  /**
   * Start a chain aggregate query.
   *
   * @group Reading - Chain API
   *
   * @example
   * ```ts
   * const totals = orm.orders
   *   .aggregate()
   *   .sum("amount", "totalRevenue")
   *   .count("*", "orderCount")
   *   .groupBy("status")
   *   .exec();
   * ```
   */
  aggregate(): AggregateBuilder<TQuery> {
    const tableName = this.tableName;
    const meta = this.meta;
    const queryExecutor = this._executor;
    const readScheduler = this._readScheduler;
    const softDeleteCol = this.descriptor.softDelete?.column;

    const executor = (state: AggregateBuilderState): Record<string, unknown>[] => {
      const aggParts: string[] = [];
      for (const [alias, { op, field }] of Object.entries(state.aggregations)) {
        const colRef = meta ? (meta.columnByPath.get(field)?.name ?? field) : field;
        const safeCol = `"${colRef}"`;
        if (op === "count" && field === "*") {
          aggParts.push(`COUNT(*) as "${alias}"`);
        } else {
          aggParts.push(`${op.toUpperCase()}(${safeCol}) as "${alias}"`);
        }
      }

      const whereResult = buildWhereFromNodes([], state.includeDeleted ? undefined : softDeleteCol, meta);

      let sql = `SELECT ${aggParts.join(", ")} FROM "${tableName}"`;
      if (whereResult.sql) sql += ` ${whereResult.sql}`;

      if (state.groupBy && state.groupBy.length > 0) {
        const groupCols = state.groupBy.map((c) => {
          const resolved = meta ? (meta.columnByPath.get(c)?.name ?? c) : c;
          return `"${resolved}"`;
        }).join(", ");
        sql += ` GROUP BY ${groupCols}`;
      }

      return queryExecutor.all<Record<string, unknown>>(sql, whereResult.params, "aggregate");
    };

    const ab = new AggregateBuilder<TQuery>(executor);

    if (readScheduler) {
      const asyncExecutor = async (state: AggregateBuilderState): Promise<Record<string, unknown>[]> => {
        const aggParts: string[] = [];
        for (const [alias, { op, field }] of Object.entries(state.aggregations)) {
          const colRef = meta ? (meta.columnByPath.get(field)?.name ?? field) : field;
          const safeCol = `"${colRef}"`;
          if (op === "count" && field === "*") {
            aggParts.push(`COUNT(*) as "${alias}"`);
          } else {
            aggParts.push(`${op.toUpperCase()}(${safeCol}) as "${alias}"`);
          }
        }

        const whereResult = buildWhereFromNodes([], state.includeDeleted ? undefined : softDeleteCol, meta);

        let sql = `SELECT ${aggParts.join(", ")} FROM "${tableName}"`;
        if (whereResult.sql) sql += ` ${whereResult.sql}`;

        if (state.groupBy && state.groupBy.length > 0) {
          const groupCols = state.groupBy.map((c) => {
            const resolved = meta ? (meta.columnByPath.get(c)?.name ?? c) : c;
            return `"${resolved}"`;
          }).join(", ");
          sql += ` GROUP BY ${groupCols}`;
        }

        return readScheduler.exec<Record<string, unknown>[]>(sql, whereResult.params);
      };
      return new AggregateBuilder<TQuery>(executor, asyncExecutor);
    }

    return ab;
  }

  // --- Update ----------------------------------------------------------------

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
      traceBegin("repo.update.extractPk");
      const obj = this._record(data as Infer<TWrite>);
      const pk = this.descriptor.primaryKey.name;
      const rawPk = obj[pk];
      if (rawPk === undefined || rawPk === null) {
        raise("UPDATE_MISSING_PK", `foxdb: update() requires primary key "${pk}"`, {
          table: this.tableName,
          column: pk,
        });
      }
      traceEnd();

      traceBegin("repo.update.fetchExisting");
      const flatRow = this._findFlatRow(this._assertPk(rawPk) as Infer<TQuery>[PK]);
      traceEnd({ found: !!flatRow });
      if (!flatRow) return null;

      traceBegin("repo.update.mergeAndFlatten");
      // Validate by merging with existing to produce a complete schema-valid object
      const existingObj = this._hydrateOne(flatRow);
      const merged = this.parse({ ...existingObj, ...data });
      const mergedObj = this._record(merged);
      if (this._timestampNames.updatedAt) {
        mergedObj[this._timestampNames.updatedAt] = Date.now();
      }
      // Build patch from user's data only -- only touch columns the user provided
      const userObj = this._record(data as Infer<TWrite>);
      const patch = flattenPatch(userObj, this.meta, this._codecs);
      delete patch[pk];
      if (this._timestampNames.updatedAt) patch[this._timestampNames.updatedAt] = mergedObj[this._timestampNames.updatedAt];
      traceEnd();

      const doUpdate = () => {
        traceBegin("repo.update.execMain");
        const { sql, params } = buildUpdate(this.tableName, pk, this._assertPk(rawPk), patch);
        this._executor.exec(sql, params, "update");
        traceEnd();

        traceBegin("repo.update.syncSubs");
        const dataRecord = data as Record<string, unknown>;
        for (const sub of this.meta.subTables) {
          if (!(sub.fieldName in dataRecord)) continue;

          this._executor.exec(
            `DELETE FROM "${sub.tableName}" WHERE "_owner_id" = ?`,
            [this._assertPk(rawPk)],
            "delete"
          );

          const items = mergedObj[sub.fieldName];
          if (!globalThis.Array.isArray(items) || items.length === 0) continue;
          const rows = flattenSubRows(this._assertPk(rawPk), items, sub, this._codecs);
          if (rows.length > 0) {
            const subBatches = buildInsertMany(sub.tableName, rows, 999, sub.insertColsSql, sub.insertValueGroup, sub.insertColumnNames);
            for (const { sql: iSql, params: iParams } of subBatches) {
              this._executor.exec(iSql, iParams, "insert");
            }
          }
        }
        traceEnd();
      };

      if (this.db._txDepth > 0) {
        doUpdate();
      } else {
        this.db.transaction(doUpdate);
      }

      const result = this._wrapNoSubs(mergedObj);
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

  // --- Delete ----------------------------------------------------------------

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

      // FK CASCADE handles sub-table deletion automatically
      const result = this.db.transaction(() => {
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

      // FK CASCADE handles sub-table deletion automatically
      const changes = this.db.transaction(() => {
        const delSql = `DELETE FROM "${this.tableName}" ${whereSql}`.trim();
        const result = this._executor.exec(delSql, params, "delete");
        return result.changes;
      });

      this._emit("deleteWhere", { where, result: changes });
      return changes;
    });
  }

  // --- Table lifecycle -------------------------------------------------------

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

  // --- Sub-table hydration ---------------------------------------------------

  private _hydrateOne(
    flat: Record<string, unknown>,
    include?: string[],
    select?: string[],
    prefetched?: Map<string, Record<string, unknown>[]>
  ): Record<string, unknown> {
    traceBegin("repo.hydrateOne");
    const pk = this.descriptor.primaryKey.name;
    const pkVal = flat[pk];

    const subRows = new Map<string, Record<string, unknown>[]>();
    for (const sub of this.meta.subTables) {
      if (include && !include!.includes(sub.fieldName)) {
        subRows.set(sub.tableName, []);
        continue;
      }

      const subMeta: TableMeta = {
        tableName: sub.tableName,
        columns: sub.columns,
        subTables: [],
        columnByName: sub.columnByName,
        columnByPath: sub.columnByPath,
        insertColumns: sub.columns,
        insertColumnNames: sub.columns.map((c) => c.name),
      };

      if (prefetched && prefetched.has(sub.tableName)) {
        const rows = prefetched.get(sub.tableName)!;
        traceBegin("repo.hydrateOne.cleanPrefetched");
        const cleaned = sub.isScalar
          ? rows.map((r) => ({ _value: r._value }))
          : rows.map((r) => hydrateRow(r, subMeta, EMPTY_MAP, this._codecs));
        traceEnd({ sub: sub.fieldName, rows: rows.length });
        subRows.set(sub.tableName, cleaned);
        continue;
      }

      traceBegin("repo.hydrateOne.fetchSub");
      const rows = this._executor.all<Record<string, unknown>>(
        `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" = ? ORDER BY "_index" ASC`,
        [pkVal as string | number],
        "read"
      );
      traceEnd({ sub: sub.fieldName, rows: rows.length });

      const cleaned = sub.isScalar
        ? rows.map((r) => ({ _value: r._value }))
        : rows.map((r) => hydrateRow(r, subMeta, EMPTY_MAP, this._codecs));

      subRows.set(sub.tableName, cleaned);
    }

    const result = hydrateRow(flat, this.meta, subRows, this._codecs, select, include);
    traceEnd();
    return result;
  }

  // --- Raw access ------------------------------------------------------------

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
    return this._executor.all<R>(sql, params.map(toBinding), "raw");
  }
}


