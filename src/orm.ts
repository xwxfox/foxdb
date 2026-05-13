/**
 * foxdb/src/orm.ts
 * Top-level ORM - creates repositories, manages cross-table relations,
 * and exposes the materializer for eager loading.
 */

import type { TObject, TSchema } from "typebox";
import type {
  ScalarKeys,
  TableConfig,
  RelationsConfig,
  Materialized,
  Entity,
  MetaAccessors,
  TimestampShape,
  QuerySchema,
  GeneratedColumnConfig
} from "./types.ts";
import type { TypedRelation } from "./typed-relation.ts";
import { BunDatabase } from "./database.ts";
import type { SQLQueryBindings } from "./database.ts";
import { Repository } from "./repository.ts";
import { introspectTable, convertGeneratedConfig } from "./schema.ts";
import { createRelationBuilder, type RelationBuilder } from "./relations.ts";
import { MetaStore } from "./meta.ts";
import { inspectAllTables } from "./inspector.ts";
import { computeDiff, type DesiredTable } from "./diff.ts";
import { applySync } from "./sync.ts";
import { migrate } from "./migrate.ts";
import type { SyncPolicy, ErrorPolicy, UnlinkPolicy, QueryMetricsHook } from "./types.ts";
import { EventBus, type ORMEvents } from "./events.ts";
import { LifecycleManager } from "./lifecycle.ts";
import type { ORMContext, LifecycleHook } from "./lifecycle.ts";
import { handleError, ORMError, raise, currentTrace } from "./errors.ts";
import { unlinkDbFiles } from "./database.ts";
import type { TableDescriptor } from "./table.ts";

// ─── Options ──────────────────────────────────────────────────────────────────

/**
 * Base options for opening a SQLite database.
 * @category Setup
 */
export interface CreateORMBaseOptions {
  /** file path - defaults to ":memory:" */
  path?: string;
  cacheSize?: number;
  busyTimeout?: number;
  synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
  mmapSize?: number;
  autoVacuum?: "incremental" | "full" | false;
  vacuumIntervalMs?: number;
  /** disable fsync during large initial loads */
  bulkLoadMode?: boolean;
}

/**
 * Options passed to `createORM`.
 *
 * @category Setup
 *
 * @example
 * ```ts
 * const orm = createORM({
 *   path: "app.db",
 *   tables: {
 *     users: table(UserSchema, (s) => ({
 *       primaryKey: s.id,
 *       indexes: [{ columns: [s.email] }],
 *       timestamps: true,
 *     })),
 *   },
 *   relations: (r) => [
 *     r.from("users").scalar("profileId").to("profiles", "id"),
 *   ],
 *   seed: (o) => {
 *     o.users.insert({ id: "1", name: "alice" });
 *   },
 *   onReady: () => console.log("db ready"),
 *   autoMigrate: true,
 *   migrations: { dir: "./migrations" },
 * });
 * ```
 */

export interface CreateORMOptions<
  T extends Record<string, TableDescriptor<any, any, any, any>> = Record<string, TableDescriptor<any, any, any, any>>,
  Rels extends readonly TypedRelation[] = readonly TypedRelation[]
> extends CreateORMBaseOptions {
  /** table schemas */
  tables: T;
  /** cross-table relations */
  relations?: RelationsConfig<any> | ((builder: RelationBuilder<T>) => Rels);
  /** how to handle schema drift */
  sync?: SyncPolicy;
  /** migration directory */
  migrations?: { dir: string };

  // ─── Lifecycle & QoL ────────────────────────────────────────────────────────
  /** runs before schema validation */
  onStart?: LifecycleHook<T, Rels>;
  /** runs after the db is fully ready */
  onReady?: LifecycleHook<T, Rels>;
  /** runs before closing the db */
  onShutdown?: LifecycleHook<T, Rels>;
  /** runs after the db is closed */
  onExit?: LifecycleHook<T, Rels>;
  /** run pending migrations on startup */
  autoMigrate?: boolean;
  /** seed data after sync */
  seed?: (orm: foxdb<T, Rels>) => void;
  /** wipe and recreate the db on every launch */
  rebuildOnLaunch?: boolean;
  /** flush these tables before seed */
  flushOnStart?: Array<keyof T & string>;
  /** flush these tables before close */
  flushOnExit?: Array<keyof T & string>;
  /** drop these tables before seed */
  dropOnStart?: Array<keyof T & string>;
  /** drop these tables before close */
  dropOnExit?: Array<keyof T & string>;
  /** wipe metadata on startup */
  flushMetaOnStart?: boolean;
  /** wipe metadata on exit */
  flushMetaOnExit?: boolean;
  /** how to handle errors */
  errorPolicy?: ErrorPolicy;
  /** delete db files on exit */
  unlinkDbFilesOnExit?: UnlinkPolicy;
  /** observability hooks */
  hooks?: QueryMetricsHook;
}

// ─── ORM return type ──────────────────────────────────────────────────────────

/**
 * The ORM object returned by `createORM`.
 *
 * Every key in your `tables` config becomes a fully typed **Repository**
 * with CRUD methods. The type definition below is a mapped type that
 * transforms your schema config into the actual runtime API — TypeDoc
 * cannot expand it, so see the example for how it works in practice.
 *
 * @see {@link Repository} for the full method reference
 *
 * @category Setup
 *
 * @example
 * ```ts
 * const orm = createORM({
 *   tables: {
 *     users: table(UserSchema, (s) => ({ primaryKey: s.id })),
 *   },
 * });
 *
 * // ─── Every table key is a Repository ───
 *
 * // Insert
 * orm.users.insert({ id: "u1", name: "alice" });
 * orm.users.insertMany([{ id: "u2", name: "bob" }]);
 *
 * // Query
 * const user   = orm.users.findById("u1");
 * const all    = orm.users.findMany();
 * const page   = orm.users.findPage({ limit: 10, offset: 0 });
 * const one    = orm.users.findOne({ where: { name: { eq: "alice" } } });
 * const count  = orm.users.count({ age: { gte: 18 } });
 *
 * // Update & delete
 * orm.users.update({ id: "u1", name: "alice smith" });
 * orm.users.upsert({ data: { id: "u1", name: "alice" }, conflictTarget: "id" });
 * orm.users.deleteById("u1");
 * orm.users.deleteWhere({ status: { eq: "banned" } });
 *
 * // ─── Framework methods (prefixed with _) ───
 *
 * orm._transaction(() => {
 *   orm.users.insert({ id: "t1", name: "txn" });
 *   orm.users.deleteById("old");
 * });
 *
 * orm._close();
 * ```
 */
export type foxdb<
  Tables extends Record<string, TableDescriptor<any, any, any, any>>,
  Rels extends readonly TypedRelation[] = readonly TypedRelation[]
> = {
  [K in keyof Tables]: Tables[K] extends TableDescriptor<
    infer TWrite extends TSchema & { properties: Record<string, TSchema> },
    infer PKName extends string,
    infer Timestamps,
    infer G extends GeneratedColumnConfig | undefined
  >
  ? Repository<
    TWrite,
    QuerySchema<TWrite, G>,
    PKName extends ScalarKeys<TWrite> ? PKName : never,
    Materialized<TWrite, Tables, Rels, K & string>,
    TimestampShape<Timestamps>
  >
  : never;
} & {
  /** run a transaction */
  _transaction<R>(fn: () => R): R;
  /** close the database */
  _close(): void;
  /** read-only metadata */
  _meta: MetaAccessors;
  /** toggle bulk-load mode (disables synchronous fsync) */
  _setBulkLoadMode(enabled: boolean): void;
  /** resolve relations for a single record */
  _materialize<Owner extends keyof Tables & string>(
    ownerTable: Owner,
    record: Record<string, unknown>
  ): Record<string, unknown>;
  /** resolve relations for many records (n+1 safe) */
  _materializeMany<Owner extends keyof Tables & string>(
    ownerTable: Owner,
    records: Record<string, unknown>[]
  ): Array<Record<string, unknown>>;
  /** truncate all tables */
  _flush(opts?: { includeMeta?: boolean }): void;
  /** run pending migrations */
  _migrate(): Promise<void>;
  /** listen to table or lifecycle events */
  _events: ORMEvents<Tables>;
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/** create a typed orm instance backed by sqlite */
export function createORM<
  const T extends Record<string, TableDescriptor<any, any, any, any>>,
  const Rels extends readonly TypedRelation[] = readonly TypedRelation[]
>(opts: CreateORMOptions<T, Rels>): foxdb<T, Rels> {
  const dbPath = opts.path ?? ":memory:";
  if (opts.rebuildOnLaunch && dbPath !== ":memory:" && dbPath.length > 0) {
    unlinkDbFiles(dbPath);
  }
  const db = new BunDatabase(opts);
  if (opts.autoVacuum === "incremental" && opts.vacuumIntervalMs) {
    db.scheduler.schedule("auto-vacuum", opts.vacuumIntervalMs, () => {
      try { db.exec("PRAGMA incremental_vacuum(1000);"); } catch { /* ignore */ }
    });
  }
  let accessors: foxdb<T, Rels>;
  const events = new EventBus();

  try {
    // Validate tables object
    const tableEntries = Object.entries(opts.tables);
    if (tableEntries.length === 0) {
      raise("NO_TABLES", "foxdb: at least one table must be defined in `tables`");
    }

    // Create repositories with eager validation
    const repos = new Map<string, Repository<any, any, any, any>>();

    for (const [name, config] of tableEntries) {
      const meta = introspectTable(
        name,
        config.schema,
        convertGeneratedConfig(config.generated)
      );
      const colNames = new Set(meta.columns.map((c) => c.name));

      // Validate primaryKey
      const pkName = config.primaryKey.name;
      if (!colNames.has(pkName)) {
        raise(
          "INVALID_PK",
          `foxdb: primary key "${pkName}" is not a scalar column in table "${name}"`,
          { table: name, column: pkName }
        );
      }

      // Validate indexes
      for (const idx of config.indexes ?? []) {
        for (const colRef of idx.columns) {
          if (!colNames.has(colRef.name)) {
            raise(
              "INVALID_INDEX",
              `foxdb: index column "${colRef.name}" not found in table "${name}"`,
              { table: name, column: colRef.name }
            );
          }
        }
      }

      const repo = new Repository(name, config, db);
      repos.set(name, repo);
    }

    // Wire EventBus into repositories
    for (const [name, repo] of repos) {
      repo.setEventBus(events);
    }

    // Wire metrics hooks into repositories
    if (opts.hooks?.onQuery) {
      for (const repo of repos.values()) {
        repo.setMetricsHook(opts.hooks.onQuery);
      }
    }

    const lifecycle = new LifecycleManager<T, Rels>();
    if (opts.onStart) lifecycle.onStart(opts.onStart);
    if (opts.onReady) lifecycle.onReady(opts.onReady);
    if (opts.onShutdown) lifecycle.onShutdown(opts.onShutdown);
    if (opts.onExit) lifecycle.onExit(opts.onExit);

    let ctx: ORMContext<T, Rels>;

    // Register and validate relations
    const relations: TypedRelation[] = [];

    if (typeof opts.relations === "function") {
      const builder = createRelationBuilder(opts.tables);
      const built = opts.relations(builder);
      for (const rel of built) {
        relations.push(rel);
      }
    } else {
      for (const [ownerTable, rels] of Object.entries(opts.relations ?? {})) {
        if (!rels) continue;

        const ownerRepo = repos.get(ownerTable);
        if (!ownerRepo) {
          raise(
            "INVALID_RELATION",
            `foxdb: relation owner table "${ownerTable}" not found in tables`,
            { table: ownerTable }
          );
        }

        for (const rel of rels) {
          const targetRepo = repos.get(rel.targetTableName);
          if (!targetRepo) {
            raise(
              "INVALID_RELATION",
              `foxdb: relation target table "${rel.targetTableName}" not found in tables`,
              { table: rel.targetTableName }
            );
          }

          // Validate ownerField
          const parts = rel.ownerField.split(".");
          if (parts.length === 1) {
            const [col = ""] = parts;
            const ownerCols = new Set(ownerRepo.meta.columns.map((c) => c.name));
            if (!ownerCols.has(col)) {
              raise(
                "INVALID_RELATION",
                `foxdb: relation ownerField "${rel.ownerField}" is not a scalar column in table "${ownerTable}"`,
                { table: ownerTable, field: rel.ownerField }
              );
            }
          } else if (parts.length === 2) {
            const [subField = "", subCol = ""] = parts;
            const sub = ownerRepo.meta.subTables.find(
              (st) => st.fieldName === subField
            );
            if (!sub) {
              raise(
                "INVALID_RELATION",
                `foxdb: relation ownerField "${rel.ownerField}" references unknown sub-table "${subField}" in table "${ownerTable}"`,
                { table: ownerTable, field: rel.ownerField }
              );
            }
            const subCols = new Set(sub.columns.map((c) => c.name));
            if (!subCols.has(subCol)) {
              raise(
                "INVALID_RELATION",
                `foxdb: relation ownerField "${rel.ownerField}" references unknown column "${subCol}" in sub-table "${subField}" of table "${ownerTable}"`,
                { table: ownerTable, field: rel.ownerField }
              );
            }
          } else {
            raise(
              "INVALID_RELATION",
              `foxdb: relation ownerField "${rel.ownerField}" has too many dot segments (max 2 allowed)`,
              { table: ownerTable, field: rel.ownerField }
            );
          }

          // Validate targetField
          const targetCols = new Set(targetRepo.meta.columns.map((c) => c.name));
          if (!targetCols.has(rel.targetField)) {
            raise(
              "INVALID_RELATION",
              `foxdb: relation targetField "${rel.targetField}" is not a scalar column in table "${rel.targetTableName}"`,
              { table: rel.targetTableName, field: rel.targetField }
            );
          }

          relations.push({
            ownerTable,
            ownerField: rel.ownerField,
            targetTable: rel.targetTableName,
            targetField: rel.targetField,
            kind: parts.length === 1 ? "scalar" : "subTable",
            as: undefined,
          });
        }
      }
    }

    // ─── Build desired schema for diffing ───────────────────────────────────────

    const desiredTables: DesiredTable[] = [];
    for (const [name, config] of tableEntries) {
      const meta = introspectTable(
        name,
        config.schema,
        convertGeneratedConfig(config.generated)
      );
      desiredTables.push({
        name,
        columns: meta.columns,
        indexes: (config.indexes ?? []).map((idx) => ({
          name: idx.name,
          columns: idx.columns.map((c) => c.name),
          unique: idx.unique,
        })),
        primaryKey: config.primaryKey.name,
      });
      for (const sub of meta.subTables) {
        desiredTables.push({
          name: sub.tableName,
          columns: sub.columns,
          indexes: (config.subTables?.[sub.fieldName]?.indexes ?? []).map((idx) => ({
            name: idx.name,
            columns: idx.columns.map((c) => c.name),
            unique: idx.unique,
          })),
          primaryKey: "_id",
        });
      }
    }

    // ─── Persist metadata ───────────────────────────────────────────────────────

    const meta = new MetaStore(db);

    const allSchemas = Object.fromEntries(
      tableEntries.map(([name, config]) => [name, config.schema])
    );
    const schemaJson = JSON.stringify(allSchemas);
    const schemaHash = Bun.hash(schemaJson);
    const schemaBytes = new TextEncoder().encode(schemaJson);

    const storedHash = meta.getString("_schema_hash");
    const currentHash = String(schemaHash);
    const schemaChanged = storedHash !== currentHash;

    if (schemaChanged && opts.sync && opts.sync !== "ignore") {
      const actualTables = inspectAllTables(db);
      const diff = computeDiff(desiredTables, actualTables);
      applySync(diff, db, opts.sync, desiredTables);
    }

    meta.setString("_schema_hash", currentHash);
    meta.setCompressed("_schema_compressed", schemaBytes);
    meta.setJSON("_tables", Object.keys(opts.tables));
    meta.setJSON("_relations", relations);
    meta.setString("_foxdb_version", "0.0.2");

    // ─── Build and inject materializers ─────────────────────────────────────────

    function materialize(
      ownerTable: string,
      record: Record<string, unknown>
    ): Record<string, unknown> {
      const tableRels = relations.filter((r) => r.ownerTable === ownerTable);
      if (tableRels.length === 0) return record;

      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(record)) {
        result[k] = v;
      }

      // ── Scalar relations (lazy) ───────────────────────────────────────────────
      const scalarRels = tableRels.filter((r) => r.kind === "scalar");
      if (scalarRels.length > 0) {
        const related = new Proxy(
          {} as Record<string, unknown>,
          {
            get(_target, prop: string) {
              const rel = scalarRels.find(
                (r) => r.as === prop || r.ownerField === prop
              );
              if (!rel) return undefined;
              const targetRepo = repos.get(rel.targetTable);
              if (!targetRepo) return null;
              const fkVal = record[rel.ownerField] as string | number | bigint | null;
              if (fkVal == null) return null;
              const found = targetRepo.raw(
                `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" = ? LIMIT 1`,
                fkVal
              )[0];
              return found ?? null;
            },
          }
        );
        Object.defineProperty(result, "related", {
          value: related,
          writable: false,
          enumerable: false,
          configurable: false,
        });

        for (const rel of scalarRels) {
          if (rel.as) {
            Object.defineProperty(result, rel.as, {
              get() {
                return (result.related as Record<string, unknown>)[rel.as!];
              },
              enumerable: false,
              configurable: false,
            });
          }
        }
      }

      // ── Sub-table relations (batch per materialize call) ──────────────────────
      const subTableRels = tableRels.filter((r) => r.kind === "subTable");
      for (const rel of subTableRels) {
        const [subField, fkField] = rel.ownerField.split(".") as [string, string];
        const items = result[subField];
        if (!globalThis.Array.isArray(items)) continue;

        const targetRepo = repos.get(rel.targetTable);
        if (!targetRepo) continue;

        const fkValues: (string | number | bigint | null)[] = items
          .map((item: unknown) => (item as Record<string, unknown>)[fkField])
          .filter((v): v is string | number | bigint | null => v != null);

        let byKey = new Map<unknown, Record<string, unknown>>();
        if (fkValues.length > 0) {
          const ph = fkValues.map(() => "?").join(", ");
          const fetched = targetRepo.raw<Record<string, unknown>>(
            `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" IN (${ph})`,
            ...fkValues
          );
          byKey = new Map(fetched.map((r) => [r[rel.targetField], r]));
        }

        result[subField] = items.map((item: unknown) => {
          const resolved =
            byKey.get((item as Record<string, unknown>)[fkField]) ?? null;
          const wrapper = Object.create(null);
          Object.assign(wrapper, item);

          const itemRelated = new Proxy(
            {} as Record<string, unknown>,
            {
              get(_target, prop: string) {
                if (prop === rel.as || prop === rel.ownerField) {
                  return resolved;
                }
                return undefined;
              },
            }
          );
          Object.defineProperty(wrapper, "related", {
            value: itemRelated,
            writable: false,
            enumerable: false,
            configurable: false,
          });

          if (rel.as) {
            Object.defineProperty(wrapper, rel.as, {
              value: resolved,
              writable: false,
              enumerable: false,
              configurable: false,
            });
          }

          return wrapper;
        });
      }

      return result;
    }

    function materializeMany(
      ownerTable: string,
      records: Record<string, unknown>[]
    ): Array<Record<string, unknown>> {
      if (records.length === 0) return [];

      const tableRels = relations.filter((r) => r.ownerTable === ownerTable);
      if (tableRels.length === 0) return records;

      const results = records.map((r) => {
        const proto = Object.getPrototypeOf(r);
        const copy = proto
          ? Object.create(proto)
          : ({} as Record<string, unknown>);
        Object.assign(copy, r);
        return copy;
      });

      const scalarRels = tableRels.filter((r) => r.kind === "scalar");
      const subTableRels = tableRels.filter((r) => r.kind === "subTable");

      for (const rel of scalarRels) {
        const targetRepo = repos.get(rel.targetTable);
        if (!targetRepo) continue;
        const col = rel.ownerField;
        const fkValues: (string | number | bigint | null)[] = [
          ...new Set(
            results
              .map((r) => r[col] as string | number | bigint | null | undefined)
              .filter((v): v is string | number | bigint | null => v !== null && v !== undefined)
          ),
        ];
        if (fkValues.length === 0) continue;
        const ph = fkValues.map(() => "?").join(", ");
        const fetched = targetRepo.raw<Record<string, unknown>>(
          `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" IN (${ph})`,
          ...fkValues
        );
        const byKey = new Map(fetched.map((r) => [r[rel.targetField], r]));
        for (const rec of results) {
          const val = byKey.get(rec[col]);
          if (val) {
            Object.defineProperty(rec, `_${col}_resolved`, {
              value: val,
              writable: false,
              enumerable: false,
              configurable: false,
            });
          }
        }
      }

      for (const rel of subTableRels) {
        const targetRepo = repos.get(rel.targetTable);
        if (!targetRepo) continue;
        const [subField, fkField] = rel.ownerField.split(".") as [string, string];
        const allFkValues: (string | number | bigint | null)[] = [
          ...new Set(
            results.flatMap((r) => {
              const items = r[subField];
              if (!globalThis.Array.isArray(items)) return [];
              return items
                .map((i) => (i as Record<string, unknown>)[fkField] as string | number | bigint | null | undefined)
                .filter((v): v is string | number | bigint | null => v !== null && v !== undefined);
            })
          ),
        ];
        if (allFkValues.length === 0) continue;
        const ph = allFkValues.map(() => "?").join(", ");
        const fetched = targetRepo.raw<Record<string, unknown>>(
          `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" IN (${ph})`,
          ...allFkValues
        );
        const byKey = new Map(fetched.map((r) => [r[rel.targetField], r]));

        for (const rec of results) {
          const items = rec[subField];
          if (!globalThis.Array.isArray(items)) continue;
          rec[subField] = items.map((item) => {
            const resolved =
              byKey.get((item as Record<string, unknown>)[fkField]) ?? null;
            const wrapper = Object.create(null);
            Object.assign(wrapper, item);

            const itemRelated = new Proxy(
              {} as Record<string, unknown>,
              {
                get(_target, prop: string) {
                  if (prop === rel.as || prop === rel.ownerField) {
                    return resolved;
                  }
                  return undefined;
                },
              }
            );
            Object.defineProperty(wrapper, "related", {
              value: itemRelated,
              writable: false,
              enumerable: false,
              configurable: false,
            });

            if (rel.as) {
              Object.defineProperty(wrapper, rel.as, {
                value: resolved,
                writable: false,
                enumerable: false,
                configurable: false,
              });
            }

            return wrapper;
          });
        }
      }

      // Attach parent .related for scalar relations (pre-resolved)
      if (scalarRels.length > 0) {
        for (const rec of results) {
          const related = new Proxy(
            {} as Record<string, unknown>,
            {
              get(_target, prop: string) {
                const rel = scalarRels.find(
                  (r) => r.as === prop || r.ownerField === prop
                );
                if (!rel) return undefined;
                return (
                  (rec as Record<string, unknown>)[
                  `_${rel.ownerField}_resolved`
                  ] ?? null
                );
              },
            }
          );
          Object.defineProperty(rec, "related", {
            value: related,
            writable: false,
            enumerable: false,
            configurable: false,
          });

          for (const rel of scalarRels) {
            if (rel.as) {
              Object.defineProperty(rec, rel.as, {
                get() {
                  return (
                    (rec as Record<string, unknown>)[
                    `_${rel.ownerField}_resolved`
                    ] ?? null
                  );
                },
                enumerable: false,
                configurable: false,
              });
            }
          }
        }
      }

      return results;
    }

    // ─── Metadata helpers ───────────────────────────────────────────────────────

    function flush(opts?: { includeMeta?: boolean }): void {
      for (const repo of repos.values()) {
        repo.flush();
      }
      if (opts?.includeMeta) {
        for (const key of ["_schema_hash", "_schema_compressed", "_tables", "_relations", "_foxdb_version"]) {
          meta.delete(key);
        }
      }
    }

    // ─── Typed meta accessors ───────────────────────────────────────────────────

    const metaAccessors: MetaAccessors = {
      get schemaHash() {
        return meta.getString("_schema_hash");
      },
      get schemaJSON() {
        const compressed = meta.getCompressed("_schema_compressed");
        return compressed ? new TextDecoder().decode(compressed) : null;
      },
      get tables() {
        return meta.getJSON<string[]>("_tables");
      },
      get relations() {
        return meta.getJSON<unknown[]>("_relations");
      },
      get version() {
        return meta.getString("_foxdb_version");
      },
    };

    // ─── Inject materializers into repositories ─────────────────────────────────

    for (const [name, repo] of repos) {
      const tableRels = relations.filter((r) => r.ownerTable === name);
      if (tableRels.length === 0) continue;

      repo.setMaterializer(
        (record) => materialize(name, record),
        (records) => materializeMany(name, records)
      );
    }

    // ─── Build accessor object with getters ─────────────────────────────────────

    accessors = Object.create(null);

    for (const name of Object.keys(opts.tables)) {
      Object.defineProperty(accessors, name, {
        get() {
          return repos.get(name)!;
        },
        enumerable: true,
        configurable: true,
      });
    }

    const migrateFn = async (): Promise<void> => {
      if (!opts.migrations) {
        raise("MIGRATIONS_NOT_CONFIGURED", "foxdb: migrations dir not configured. Pass `migrations: { dir: ... }` to createORM().");
      }
      await migrate({
        path: dbPath,
        migrationsDir: opts.migrations.dir,
      });
    };

    const ormEvents = {
      on(eventOrTable: string, opOrListener: unknown, maybeListener?: unknown): () => void {
        if (typeof opOrListener === "string" && typeof maybeListener === "function") {
          const event = `${eventOrTable}.${opOrListener}`;
          // The typed listener `(payload: SpecificEvent) => void` must be cast
          // to `(payload: unknown) => void` for storage. This is safe because
          // the event string is generated from the same table+operation, and
          // the public ORMEvents interface guarantees the payload type matches.
          return events.on(event, maybeListener as (payload: unknown) => void);
        }
        if (typeof opOrListener === "function") {
          // Same contravariance boundary cast for global lifecycle events.
          return events.on(eventOrTable, opOrListener as (payload: unknown) => void);
        }
        raise("INVALID_EVENT_LISTENER", "foxdb: invalid event listener arguments");
      },
    };

    // Bulk-load mode
    if (opts.bulkLoadMode) {
      db.setSynchronous("OFF");
    }

    // Build context
    ctx = {
      orm: accessors,
      db,
      meta,
      tables: Object.keys(opts.tables),
      repos,
      logger: {
        log: (...args: unknown[]) => { console.log("[foxdb]", ...args); },
        error: (...args: unknown[]) => { console.error("[foxdb]", ...args); },
      },
    };

    function close(): void {
      lifecycle.runShutdown(ctx);

      // Flush / drop tables on exit
      if (opts.flushOnExit) {
        for (const name of opts.flushOnExit) {
          repos.get(name)?.flush();
        }
      }
      if (opts.dropOnExit) {
        for (const name of opts.dropOnExit) {
          repos.get(name)?.drop();
        }
      }
      if (opts.flushMetaOnExit) {
        for (const key of ["_schema_hash", "_schema_compressed", "_tables", "_relations", "_foxdb_version"]) {
          meta.delete(key);
        }
      }

      db.close();

      lifecycle.runExit(ctx);
      events.emit("exit", { phase: "exit", timestamp: Date.now() });

      const unlinkPolicy = opts.unlinkDbFilesOnExit;
      if (unlinkPolicy === true || unlinkPolicy === "onlyGraceful") {
        unlinkDbFiles(dbPath);
      }
    }

    // Crash-time unlink + exit hooks
    if (opts.unlinkDbFilesOnExit === "any") {
      const doUnlink = () => {
        try { unlinkDbFiles(dbPath); } catch { }
      };
      const gracefulCrash = () => {
        lifecycle.runExit(ctx);
        doUnlink();
        process.exit(1);
      };
      process.on("exit", doUnlink);
      process.on("SIGINT", gracefulCrash);
      process.on("SIGTERM", gracefulCrash);
      process.on("uncaughtException", (err) => {
        events.emit("fail", { phase: "fail", error: err, timestamp: Date.now() });
        gracefulCrash();
      });
    }

    // Assign public API before lifecycle hooks so ctx.orm._meta etc. are available
    Object.assign(accessors, {
      _transaction: db.transaction.bind(db),
      _close: close,
      _setBulkLoadMode(enabled: boolean): void {
        db.setSynchronous(enabled ? "OFF" : "NORMAL");
      },
      _meta: metaAccessors,
      _materialize: materialize,
      _materializeMany: materializeMany,
      _flush: flush,
      _migrate: migrateFn,
      _events: ormEvents,
    });

    // Run startup sequence deterministically
    lifecycle.runStart(ctx);

    // Flush / drop tables on start
    if (opts.flushOnStart) {
      for (const name of opts.flushOnStart) {
        repos.get(name)?.flush();
      }
    }
    if (opts.dropOnStart) {
      for (const name of opts.dropOnStart) {
        repos.get(name)?.drop();
      }
    }
    if (opts.flushMetaOnStart) {
      for (const key of ["_schema_hash", "_schema_compressed", "_tables", "_relations", "_foxdb_version"]) {
        meta.delete(key);
      }
    }

    // Auto-migrate (fire-and-forget; errors are logged)
    if (opts.autoMigrate && opts.migrations) {
      migrate({ path: dbPath, migrationsDir: opts.migrations.dir }).catch((err: unknown) => {
        console.error("[foxdb] autoMigrate failed:", err);
      });
    }

    // Seed
    if (opts.seed) {
      opts.seed(accessors);
    }

    // Ready
    lifecycle.runReady(ctx);
    events.emit("ready", { phase: "ready", timestamp: Date.now() });

  } catch (err) {
    // Initialization errors are ALWAYS thrown - a broken ORM is unusable
    if (err instanceof ORMError) {
      events.emit("fail", { phase: "fail", error: err, timestamp: Date.now() });
    } else {
      const wrapped = new ORMError(String(err), { code: "UNEXPECTED", trace: currentTrace() });
      events.emit("fail", { phase: "fail", error: wrapped, timestamp: Date.now() });
    }
    throw err;
  }

  return accessors;
}