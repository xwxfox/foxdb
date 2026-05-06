/**
 * bunorm/src/types.ts
 * Core type utilities - all ORM-level TypeScript types live here.
 * Zero runtime cost; pure compile-time machinery.
 */

import type {
  TObject,
  TArray,
  TSchema,
  TProperties,
  TOptional,
  Static,
} from "typebox";
import type { ColumnRef, TScalarSchema } from "./columns.ts";
import type { TypedRelation } from "./typed-relation.ts";

/** @internal */
export type UnwrapOptional<T> = T extends TOptional<infer U> ? U : T;

// ─── Primitive column types ──────────────────────────────────────────────────

/**
 * scalar values sqlite can store natively
 * @category Advanced
 */
export type SqliteScalar = string | number | boolean | null | bigint;

// ─── Schema introspection helpers ────────────────────────────────────────────

/**
 * @internal
 * @category Advanced
 */
export type ScalarProperties<P extends TProperties> = {
  [K in keyof P as P[K] extends TArray<infer _> ? never : K]: P[K];
};

/**
 * @internal
 * @category Advanced
 */
export type ArrayOfObjectProperties<P extends TProperties> = {
  [K in keyof P as P[K] extends TArray<{ properties: Record<string, TSchema> }>
  ? K
  : never]: P[K] extends TArray<infer Item> ? Item : never;
};

/**
 * column names that are scalar (not arrays or nested objects)
 * @category Query Types
 */
export type ScalarKeys<T extends TSchema & { properties: Record<string, TSchema> }> =
  keyof ScalarProperties<T["properties"]> & string;

/**
 * @internal
 * @category Query Types
 */
export type SubTableKeys<T extends TSchema & { properties: Record<string, TSchema> }> =
  keyof ArrayOfObjectProperties<T["properties"]> & string;

/**
 * @internal
 * @category Advanced
 */
export type SubTableScalarPath<T extends TSchema & { properties: Record<string, TSchema> }> = {
  [K in SubTableKeys<T>]: T["properties"][K] extends TArray<infer Item>
  ? Item extends { properties: Record<string, TSchema> }
  ? `${K}.${ScalarKeys<Item>}`
  : never
  : never;
}[SubTableKeys<T>];

/**
 * @internal
 * @category Advanced
 */
export type ScalarPath<T extends TSchema & { properties: Record<string, TSchema> }> =
  | ScalarKeys<T>
  | SubTableScalarPath<T>;

/** @internal */
export type JsonPathLevel1<T extends TSchema & { properties: Record<string, TSchema> }> = {
  [K in keyof T["properties"] & string]: UnwrapOptional<T["properties"][K]> extends { properties: Record<string, TSchema> }
    ? `${K}.${keyof UnwrapOptional<T["properties"][K]>["properties"] & string}`
    : never;
}[keyof T["properties"] & string];

/** @internal */
export type JsonPathLevel2<T extends TSchema & { properties: Record<string, TSchema> }> = {
  [K in keyof T["properties"] & string]: UnwrapOptional<T["properties"][K]> extends { properties: Record<string, TSchema> }
    ? {
        [K2 in keyof UnwrapOptional<T["properties"][K]>["properties"] & string]: UnwrapOptional<UnwrapOptional<T["properties"][K]>["properties"][K2]> extends { properties: Record<string, TSchema> }
          ? `${K}.${K2}.${keyof UnwrapOptional<UnwrapOptional<T["properties"][K]>["properties"][K2]>["properties"] & string}`
          : never
      }[keyof UnwrapOptional<T["properties"][K]>["properties"] & string]
    : never;
}[keyof T["properties"] & string];

/** @internal */
export type JsonPath<T extends TSchema & { properties: Record<string, TSchema> }> = JsonPathLevel1<T> | JsonPathLevel2<T>;

/** @internal */
export type PathValue<T extends TSchema & { properties: Record<string, TSchema> }, P extends string> =
  P extends `${infer K}.${infer Rest}`
  ? UnwrapOptional<T["properties"][K]> extends { properties: Record<string, TSchema> }
    ? Rest extends `${infer K2}.${infer Rest2}`
      ? UnwrapOptional<UnwrapOptional<T["properties"][K]>["properties"][K2]> extends { properties: Record<string, TSchema> }
        ? UnwrapOptional<UnwrapOptional<T["properties"][K]>["properties"][K2]>["properties"][Rest2] extends TSchema
          ? Static<UnwrapOptional<UnwrapOptional<T["properties"][K]>["properties"][K2]>["properties"][Rest2]>
          : never
        : never
      : UnwrapOptional<T["properties"][K]>["properties"][Rest] extends TSchema
      ? Static<UnwrapOptional<T["properties"][K]>["properties"][Rest]>
      : never
    : never
  : never;

// ─── Static inference shortcuts ──────────────────────────────────────────────

/**
 * the typescript type that matches a typebox schema
 * @category Query Types
 */
export type Infer<T extends TSchema> = Static<T>;

/**
 * @internal
 * @category Advanced
 */
export type FlatRow<T extends TSchema & { properties: Record<string, TSchema> }> = {
  [K in ScalarKeys<T>]: Static<T["properties"][K]>;
};

/**
 * @internal
 * @category Advanced
 */
export type SubTableItem<
  T extends TSchema & { properties: Record<string, TSchema> },
  K extends SubTableKeys<T>
> = T["properties"][K] extends TArray<infer Item extends TSchema>
  ? Static<Item>
  : never;

/**
 * @internal
 * @category Advanced
 */
export type SubTableItemKeys<
  T extends TSchema & { properties: Record<string, TSchema> },
  K extends SubTableKeys<T>
> = T["properties"][K] extends TArray<infer Item>
  ? Item extends { properties: Record<string, TSchema> }
  ? ScalarKeys<Item>
  : never
  : never;

// ─── Filter / Where types ─────────────────────────────────────────────────────

/** @category Query Types */
export type ScalarFilter<V> = V extends string
  ?
  | { eq: V }
  | { ne: V }
  | { like: string }
  | { in: V[] }
  | { notIn: V[] }
  | { isNull: true }
  | { isNotNull: true }
  : V extends number | bigint
  ?
  | { eq: V }
  | { ne: V }
  | { gt: V }
  | { gte: V }
  | { lt: V }
  | { lte: V }
  | { between: [V, V] }
  | { in: V[] }
  | { isNull: true }
  | { isNotNull: true }
  : V extends boolean
  ? { eq: V } | { isNull: true } | { isNotNull: true }
  : V extends object
  ? { eq: V } | { ne: V } | { isNull: true } | { isNotNull: true }
  : { isNull: true } | { isNotNull: true };

/**
 * Where filters for queries - only scalar columns are filterable.
 *
 * @example
 * ```ts
 * // String filters
 * orm.users.findMany({ where: { name: { like: "%alice%" } } });
 * orm.users.findMany({ where: { email: { in: ["a@x.com", "b@x.com"] } } });
 *
 * // Number filters
 * orm.users.findMany({ where: { age: { gte: 18, lte: 65 } } });
 * orm.products.findMany({ where: { price: { between: [10, 100] } } });
 *
 * // Boolean / null filters
 * orm.users.findMany({ where: { active: { eq: true } } });
 * orm.users.findMany({ where: { deletedAt: { isNull: true } } });
 * ```
 * @category Query Types
 * @category Query Types
 */
export type WhereClause<T extends TSchema & { properties: Record<string, TSchema> }> = {
  [K in ScalarKeys<T>]?: ScalarFilter<Static<T["properties"][K]>>;
} & {
  [K in JsonPath<T>]?: ScalarFilter<PathValue<T, K>>;
} & {
  AND?: WhereClause<T>[];
  OR?: WhereClause<T>[];
  NOT?: WhereClause<T>;
};

// ─── OrderBy ─────────────────────────────────────────────────────────────────

/**
 * sort direction for queries
 * @category Query Types
 */
export type OrderByClause<T extends TSchema & { properties: Record<string, TSchema> }> = {
  column: ScalarKeys<T>;
  direction?: "ASC" | "DESC";
};

// ─── Pagination ───────────────────────────────────────────────────────────────

/**
 * @internal
 * @category Advanced
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

// ─── Query options ────────────────────────────────────────────────────────────

/**
 * Options for `findMany`, `findPage`, and `findOne`.
 *
 * @example
 * ```ts
 * orm.users.findMany({
 *   where: { age: { gte: 18 } },
 *   orderBy: { column: "name", direction: "ASC" },
 *   limit: 10,
 *   offset: 0,
 * });
 *
 * // Multiple orderBy clauses
 * orm.users.findMany({
 *   orderBy: [
 *     { column: "status", direction: "DESC" },
 *     { column: "createdAt", direction: "ASC" },
 *   ],
 * });
 *
 * // Include sub-tables
 * orm.orders.findMany({ include: ["lineItems"] });
 * ```
 * @category Query Types
 * @category Query Types
 */
export interface FindOptions<T extends TSchema & { properties: Record<string, TSchema> }> extends PaginationOptions {
  where?: WhereClause<T>;
  orderBy?: OrderByClause<T> | OrderByClause<T>[];
  include?: SubTableKeys<T>[];
  select?: ScalarKeys<T>[];
  includeDeleted?: boolean;
}

// ─── Insert / Update ──────────────────────────────────────────────────────────

/**
 * full record to insert
 * @category Query Types
 */
export type InsertData<T extends TSchema & { properties: Record<string, TSchema> }> = Infer<T>;

/**
 * update payload - must include the primary key
 * @category Query Types
 */
export type UpdateData<T extends TSchema & { properties: Record<string, TSchema> }, PK extends ScalarKeys<T>> = Pick<
  Infer<T>,
  PK
> &
  Partial<Omit<Infer<T>, PK>>;

// ─── Index definition ────────────────────────────────────────────────────────

/**
 * index on one or more columns
 * @category Schema
 */
export interface IndexDefinition {
  name?: string;
  columns: ColumnRef<string, TScalarSchema>[];
  unique?: boolean;
  where?: string;
  include?: ColumnRef<string, TScalarSchema>[];
}

// ─── Timestamp types ─────────────────────────────────────────────────────────

/**
 * timestamp configuration for a table
 * @category Schema
 */
export type TimestampConfig = true | false | { createdAt?: string; updatedAt?: string } | undefined;

/**
 * @internal
 * @category Schema
 */
export type TimestampShape<T extends TimestampConfig> = true extends T
  ? { createdAt: number; updatedAt: number }
  : [T] extends [{ createdAt?: infer C; updatedAt?: infer U }]
  ? (C extends string ? { [K in C]: number } : {}) & (U extends string ? { [K in U]: number } : {})
  : {};

// ─── Entity helper ───────────────────────────────────────────────────────────

/**
 * A database row with optional timestamps and materialized relations.
 *
 * @example
 * ```ts
 * // Without relations
 * type User = Entity<{ id: string; name: string }>;
 * // → { id: string; name: string }
 *
 * // With timestamps
 * type UserWithTS = Entity<{ id: string }, never, { createdAt: number }>;
 * // → { id: string; createdAt: number }
 *
 * // With relations
 * type UserWithRels = Entity<{ id: string }, { posts: Post[] }>;
 * // → { id: string; materialize(): { posts: Post[] } }
 * ```
 * @category Query Types
 * @category Query Types
 */
export type Entity<T, Mat = never, TS = {}> = [Mat] extends [never]
  ? T & TS
  : T & TS & { materialize(): Mat };

export type ProjectedEntity<
  T extends TSchema & { properties: Record<string, TSchema> },
  Mat = never,
  TS = {},
  K extends ScalarKeys<T> = ScalarKeys<T>
> = Pick<Infer<T>, K> & TS;

// ─── Table config (what users pass per table in `createORM`) ─────────────────

/**
 * table descriptor passed to createORM
 * @category Schema
 */
export interface EvictionConfig {
  maxRows?: number;
  ttlColumn?: string;
  ttlMs?: number;
  lruColumn?: string;
}

export interface CompressionConfig {
  columns: ColumnRef<string, TScalarSchema>[];
  algorithm: "gzip" | "none";
}

export interface SoftDeleteConfig {
  column: string;
}

export interface TableConfig<
  T extends TSchema & { properties: Record<string, TSchema> } = TSchema & { properties: Record<string, TSchema> },
  PK extends string = string,
  TS extends TimestampConfig = undefined
> {
  schema: T;
  primaryKey: ColumnRef<PK>;
  indexes?: IndexDefinition[];
  subTables?: Partial<Record<string, { indexes?: IndexDefinition[] }>>;
  timestamps?: TS;
  eviction?: EvictionConfig;
  compression?: CompressionConfig;
  softDelete?: SoftDeleteConfig;
}

// ─── Meta accessors ──────────────────────────────────────────────────────────

/**
 * read-only metadata about the current database schema
 * @category Setup
 */
export interface MetaAccessors {
  schemaHash: string | null;
  schemaJSON: string | null;
  tables: string[] | null;
  relations: unknown[] | null;
  version: string | null;
}

// ─── Relations ────────────────────────────────────────────────────────────────

/**
 * @internal
 * @category Advanced
 */
export interface BuiltRelation {
  ownerTable: string;
  ownerField: string;
  targetTable: string;
  targetField: string;
  as?: string;
  kind: "scalar" | "subTable";
}

/**
 * @internal
 * @category Relations
 */
export interface RelationEntry<
  Tables extends Record<string, TableConfig<any, any, any>>,
  Owner extends keyof Tables,
  Target extends keyof Tables
> {
  ownerField: ScalarPath<Tables[Owner]["schema"]>;
  targetTableName: Target;
  targetField: ScalarKeys<Tables[Target]["schema"]>;
}

/**
 * @internal
 * @category Relations
 */
export type RelationsConfig<
  Tables extends Record<string, TableConfig<any, any, any>>
> = {
    [K in keyof Tables & string]?: Array<
      {
        [Target in keyof Tables & string]: RelationEntry<
          Tables,
          K,
          Target
        >;
      }[keyof Tables & string]
    >;
  };

// ─── Materialized types ───────────────────────────────────────────────────────

/**
 * @internal
 * @category Relations
 */
export type ScalarMergeNames<
  Rels extends readonly TypedRelation[],
  Owner extends string
> = Extract<
  Rels[number],
  { ownerTable: Owner; kind: "scalar" }
> extends TypedRelation<any, any, any, any, any, infer A>
  ? A extends string
  ? A
  : never
  : never;

/**
 * @internal
 * @category Relations
 */
export type ScalarMergeType<
  Tables extends Record<string, TableConfig<any, any, any>>,
  Rels extends readonly TypedRelation[],
  Owner extends string,
  Name extends string
> = Extract<
  Rels[number],
  { ownerTable: Owner; kind: "scalar"; as: Name }
> extends TypedRelation<any, any, infer TT, any, any, any>
  ? TT extends keyof Tables
  ? Infer<Tables[TT]["schema"]> | null
  : never
  : never;

/**
 * @internal
 * @category Relations
 */
export type ScalarMerge<
  Tables extends Record<string, TableConfig<any, any, any>>,
  Rels extends readonly TypedRelation[],
  Owner extends string
> = {
    [K in ScalarMergeNames<Rels, Owner>]: ScalarMergeType<
      Tables,
      Rels,
      Owner,
      K
    >;
  };

/**
 * @internal
 * @category Relations
 */
export type SubMergeNames<
  Rels extends readonly TypedRelation[],
  Owner extends string,
  Sub extends string
> = Extract<
  Rels[number],
  { ownerTable: Owner; kind: "subTable"; ownerField: `${Sub}.${string}` }
> extends TypedRelation<any, any, any, any, any, infer A>
  ? A extends string
  ? A
  : never
  : never;

/**
 * @internal
 * @category Relations
 */
export type SubMergeType<
  Tables extends Record<string, TableConfig<any, any, any>>,
  Rels extends readonly TypedRelation[],
  Owner extends string,
  Sub extends string,
  Name extends string
> = Extract<
  Rels[number],
  { ownerTable: Owner; kind: "subTable"; ownerField: `${Sub}.${string}`; as: Name }
> extends TypedRelation<any, any, infer TT, any, any, any>
  ? TT extends keyof Tables
  ? Infer<Tables[TT]["schema"]> | null
  : never
  : never;

/**
 * @internal
 * @category Relations
 */
export type SubMerge<
  Tables extends Record<string, TableConfig<any, any, any>>,
  Rels extends readonly TypedRelation[],
  Owner extends string,
  Sub extends string
> = {
    [K in SubMergeNames<Rels, Owner, Sub>]: SubMergeType<
      Tables,
      Rels,
      Owner,
      Sub,
      K
    >;
  };

/**
 * Entity with resolved relations. Sub-table arrays get their related entities
 * merged in, and scalar relations appear as direct properties.
 *
 * @example
 * ```ts
 * // Given: OrderSchema with lineItems: Array<{ sku: string; qty: number }>
 * // And a relation: lineItems.sku → products.sku (as "product")
 *
 * type M = Materialized<OrderSchema, Tables, Rels, "orders">;
 * // M.lineItems becomes Array<{ sku: string; qty: number; product: Product | null }>
 * // M also gets scalar relation properties like `.related` accessors
 * ```
 * @category Relations
 * @category Relations
 */
export type Materialized<
  T extends TSchema & { properties: Record<string, TSchema> },
  Tables extends Record<string, TableConfig<any, any, any>>,
  Rels extends readonly TypedRelation[],
  Owner extends string
> = {
  [K in keyof Infer<T>]: K extends string
  ? Infer<T>[K] extends Array<infer Item>
  ? Array<Item & SubMerge<Tables, Rels, Owner, K>>
  : Infer<T>[K]
  : Infer<T>[K];
} & ScalarMerge<Tables, Rels, Owner>;

// ─── Result types ─────────────────────────────────────────────────────────────

/**
 * paginated query result
 * @category Query Types
 */
export interface PageResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

/**
 * insert or update on conflict
 * @category Query Types
 */
export interface UpsertOptions<T extends TSchema & { properties: Record<string, TSchema> }, PK extends ScalarKeys<T>> {
  data: InsertData<T>;
  conflictTarget: PK | PK[];
  /** columns to update on conflict - defaults to all non-pk columns */
  update?: Array<ScalarKeys<T>>;
}

// ─── Migration types ──────────────────────────────────────────────────────────

/**
 * a single migration step
 * @category Migration
 */
export interface Migration {
  name: string;
  date: string;
  up: (db: import("./database.ts").BunDatabase) => void;
  down?: (db: import("./database.ts").BunDatabase) => void;
}

/**
 * options for migrate()
 * @category Migration
 */
export interface MigrateOptions {
  path: string;
  migrationsDir: string;
  direction?: "up";
  target?: string;
}

/**
 * @internal
 * @category Migration
 */
export type SchemaChange =
  | { kind: "add-table"; table: string }
  | { kind: "add-column"; table: string; column: { name: string; sqlType: string; nullable: boolean; optional: boolean }; hasDefault: boolean }
  | { kind: "add-index"; table: string; index: { name: string; unique: number; columns: string[] } }
  | { kind: "add-subtable"; table: string; subTable: { fieldName: string; tableName: string; columns: { name: string; sqlType: string; nullable: boolean; optional: boolean }[] } }
  | { kind: "drop-column"; table: string; column: string }
  | { kind: "rename-column"; table: string; from: string; to: string }
  | { kind: "change-type"; table: string; column: string; from: string; to: string }
  | { kind: "change-nullable"; table: string; column: string; to: boolean }
  | { kind: "drop-table"; table: string }
  | { kind: "change-pk"; table: string }
  | { kind: "drop-index"; table: string; index: { name: string; unique: number; columns: string[] } };

/**
 * @internal
 * @category Migration
 */
export interface SchemaDiff {
  safe: SchemaChange[];
  unsafe: SchemaChange[];
}

/**
 * how to handle schema drift on startup
 * @category Migration
 */
export type SyncPolicy =
  | "ignore"
  | "warn"
  | "error"
  | "auto"
  | ((diff: SchemaDiff, db: import("./database.ts").BunDatabase) => boolean | void);

// ─── Aggregation ──────────────────────────────────────────────────────────────

/** @category Query Types */
export type AggregationOp<T extends TSchema & { properties: Record<string, TSchema> } = TSchema & { properties: Record<string, TSchema> }> =
  | { sum?: ScalarKeys<T> }
  | { count?: "*" | ScalarKeys<T> }
  | { avg?: ScalarKeys<T> }
  | { min?: ScalarKeys<T> }
  | { max?: ScalarKeys<T> };

/** @category Query Types */
export interface AggregateOptions<
  T extends TSchema & { properties: Record<string, TSchema> },
  A extends Record<string, AggregationOp<T>> = Record<string, AggregationOp<T>>
> {
  where?: WhereClause<T>;
  groupBy?: readonly ScalarKeys<T>[];
  aggregations: A;
  includeDeleted?: boolean;
}

/** @category Query Types */
export type AggregateResult<
  A extends Record<string, AggregationOp<any>>,
  G extends readonly string[] | undefined = undefined
> = Array<{ [K in keyof A]: unknown } & (G extends readonly string[] ? { [K in G[number]]: unknown } : {})>;

// ─── Query Metrics ────────────────────────────────────────────────────────────

/** @category Observability */
export interface QueryMetrics {
  table: string;
  operation: string;
  sql: string;
  durationMs: number;
  rowCount: number;
}

/** @category Observability */
export interface QueryMetricsHook {
  onQuery: (meta: QueryMetrics) => void;
}

// ─── Event types ──────────────────────────────────────────────────────────────

/**
 * specific operations that can be listened to per table
 * @category Events
 */
export type TableOperation =
  | "insert"
  | "insertMany"
  | "update"
  | "delete"
  | "deleteWhere"
  | "upsert"
  | "findById"
  | "findMany"
  | "findOne"
  | "findPage"
  | "iterate"
  | "count"
  | "flush"
  | "aggregate";

/**
 * broad categories for event listening
 * @category Events
 */
export type BroadOperation = "read" | "write" | "delete";

/**
 * @internal
 * @category Events
 */
export type TableEventOperation = TableOperation | BroadOperation;

/**
 * payload delivered to event listeners
 * @category Events
 */
export interface TableEventPayload<
  T = unknown,
  Op extends TableEventOperation = TableEventOperation
> {
  table: string;
  operation: Op;
  data?: T | T[] | Partial<T> | Record<string, unknown>;
  result?: T | T[] | PageResult<T> | number | null;
  id?: unknown;
  where?: unknown;
  options?: unknown;
  timestamp: number;
}

// ─── Lifecycle config primitives ──────────────────────────────────────────────

/**
 * how to handle errors
 * @category Errors
 */
export type ErrorPolicy = "throw" | "emit" | "emit-swallow" | "crash";

/**
 * when to delete db files on shutdown
 * @category Setup
 */
export type UnlinkPolicy = true | "onlyGraceful" | "any" | false | undefined;
