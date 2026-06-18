/**
 * foxdb - typed sqlite orm backed by typebox
 *
 * ```ts
 * import { createORM, table } from "@xwxfox/foxdb";
 * import { Object, String } from "typebox";
 *
 * const orm = createORM({
 *   tables: {
 *     users: table(Object({ id: String(), name: String() }), s => ({
 *       primaryKey: s.id
 *     }))
 *   }
 * });
 *
 * orm.users.insert({ id: "1", name: "alice" });
 * const user = orm.users.findById("1");
 * ```
 */

// --- Setup --------------------------------------------------------------------

/** @category Setup */
export { createORM } from "./orm.ts";
/** @category Setup */
export type { foxdb, CreateORMOptions, CreateORMBaseOptions } from "./orm.ts";

// --- Repositories -------------------------------------------------------------

/** @category Repositories */
export { Repository } from "./repository.ts";

// --- Chain Query API ----------------------------------------------------------

/** @category Query Building */
export { FilterBuilder, AggregateBuilder, buildWhereFromNodes } from "./filter-builder.ts";
/** @category Query Building */
export type {
  ConditionNode,
  InternalBuilderState,
  AggregateBuilderState,
} from "./filter-builder.ts";

// --- Database -----------------------------------------------------------------

/** @category Database */
export { BunDatabase } from "./database.ts";
/** @category Database */
export type { BunStatement, DatabaseOptions } from "./database.ts";

// --- Schema -------------------------------------------------------------------

/** @category Schema */
export { table } from "./table.ts";
/** @category Schema */
export type { TableDescriptor, SubTableConfig, TableConfigShape } from "./table.ts";
/** @category Schema */
export type { GeneratedColumnConfig } from "./types.ts";

/** @category Schema */
export type { ColumnRef, ColumnRefs, TScalarSchema } from "./columns.ts";

// --- Query Types --------------------------------------------------------------

/** @category Query Types */
export type {
  Infer,
  WhereClause,
  OrderByClause,
  FindOptions,
  InsertData,
  UpdateData,
  UpsertOptions,
  PageResult,
  TableConfig,
  IndexDefinition,
  Entity,
  ScalarKeys,
  SubTableKeys,
  ScalarFilter,
  AggregateOptions,
  AggregationOp,
  FilterableFields,
  FieldType,
  ArrayFilterableFields,
  ArrayItemType,
  OrderableFields,
  DistinctableFields,
} from "./types.ts";

// --- Relations ----------------------------------------------------------------

/** @category Relations */
export { createRelationBuilder } from "./relations.ts";
/** @category Relations */
export type { RelationBuilder } from "./relations.ts";
/** @category Relations */
export type { TypedRelation } from "./typed-relation.ts";
/** @category Relations */
export type {
  Materialized,
  RelationsConfig,
  RelationEntry,
  SubMerge,
  ScalarMerge,
  ScalarMergeNames,
  ScalarMergeType,
  SubMergeNames,
  SubMergeType,
  ScalarPath,
  SubTableScalarPath,
} from "./types.ts";

// --- Events -------------------------------------------------------------------

/** @category Events */
export { EventBus } from "./events.ts";
/** @category Events */
export type { LifecycleEventMap, ORMEvents, Listener } from "./events.ts";
/** @category Events */
export type { TableOperation, BroadOperation, TableEventPayload, TableEventOperation } from "./types.ts";

// --- Observability ------------------------------------------------------------

/** @category Observability */
export type { QueryMetrics, QueryMetricsHook } from "./types.ts";

// --- Batch Writer -------------------------------------------------------------

/** @category Writing */
export { BatchWriter } from "./batch-writer.ts";
/** @category Writing */
export type { BatchWriterOptions } from "./batch-writer.ts";

// --- Lifecycle ----------------------------------------------------------------

/** @category Lifecycle */
export { LifecycleManager } from "./lifecycle.ts";
/** @category Lifecycle */
export type { ORMContext, LifecycleHook } from "./lifecycle.ts";

// --- Migration ----------------------------------------------------------------

/** @category Migration */
export { migrate } from "./migrate.ts";
/** @category Migration */
export { createMigration } from "./migration-template.ts";
/** @category Migration */
export type { Migration, MigrateOptions, SchemaDiff, SchemaChange, SyncPolicy } from "./types.ts";

// --- Errors -------------------------------------------------------------------

/** @category Errors */
export { ORMError, raise, withTrace } from "./errors.ts";
/** @category Errors */
export type { ORMErrorContext, TraceEntry, ErrorPolicy } from "./errors.ts";
/** @category Setup */
export type { UnlinkPolicy } from "./types.ts";

// --- Introspection ------------------------------------------------------------

/** @category Advanced */
export { introspectTable, buildCreateTableSQL } from "./schema.ts";
/** @category Advanced */
export type { TableMeta, ColumnMeta, SubTableMeta, SqliteType } from "./schema.ts";

/** @category Advanced */
export { MetaStore } from "./meta.ts";
/** @category Advanced */
export type { SchemaJSON } from "./meta.ts";
/** @category Advanced */
export { SchemaJSONSchema } from "./meta.ts";

/** @category Advanced */
export { resolveTimestampNames, DEFAULT_TIMESTAMP_NAMES } from "./timestamps.ts";
/** @category Advanced */
export type { TimestampConfig as TimestampNamesConfig } from "./timestamps.ts";

/** @category Advanced */
export { inspectSchema, inspectAllTables } from "./inspector.ts";
/** @category Advanced */
export type { InspectorTable, InspectorColumn, InspectorIndex } from "./inspector.ts";

/** @category Advanced */
export { computeDiff } from "./diff.ts";
/** @category Advanced */
export type { DesiredTable } from "./diff.ts";

/** @category Advanced */
export { applySync } from "./sync.ts";

// --- Internal helpers (not for public use) ------------------------------------

/** @category Advanced */
export type {
  TimestampShape,
  ScalarProperties,
  ArrayOfObjectProperties,
} from "./types.ts";
