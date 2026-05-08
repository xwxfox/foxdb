/**
 * bunorm/src/table.ts
 * User-facing helper that wraps a schema + configuration into a descriptor.
 * Guarantees compile-time safety for PK and index columns via ColumnRef.
 */

import type { TObject, TSchema } from "typebox";
import type { ColumnRef, TScalarSchema, ColumnRefs } from "./columns.ts";
import { createColumnProxy } from "./columns.ts";
import type { IndexDefinition, TimestampConfig, TableConfig, EvictionConfig, CompressionConfig } from "./types.ts";

/** @category Schema */
export interface SubTableConfig {
  indexes?: IndexDefinition[];
}

/** @category Schema */
export interface TableDescriptor<
  T extends TSchema & { properties: Record<string, TSchema> },
  PK extends string,
  TS extends TimestampConfig = undefined
> extends TableConfig<T, PK, TS> { }

/** @category Schema */
export interface TableConfigShape<PK extends string, TS extends TimestampConfig> {
  primaryKey: ColumnRef<PK>;
  indexes?: IndexDefinition[];
  subTables?: Partial<Record<string, SubTableConfig>>;
  timestamps?: TS;
  eviction?: EvictionConfig;
  compression?: CompressionConfig;
  softDelete?: import("./types.ts").SoftDeleteConfig;
  generated?: import("./types.ts").GeneratedColumn[];
}

/**
 * Describe a table schema + config for `createORM`.
 *
 * @example
 * ```ts
 * const UserSchema = Object({ id: String(), name: String(), email: String() });
 *
 * const users = table(UserSchema, (s) => ({
 *   primaryKey: s.id,
 *   indexes: [{ columns: [s.email], unique: true }],
 *   timestamps: true, // adds createdAt / updatedAt
 * }));
 * ```
 * @category Schema
 * @category Schema
 */
export function table<
  T extends TSchema & { properties: Record<string, TSchema> },
  PK extends string,
  const TS extends boolean
>(
  schema: T,
  configure: (columns: ColumnRefs<T>) => TableConfigShape<PK, TS> & { timestamps: TS }
): TableDescriptor<T, PK, TS>;

/** @category Schema */
export function table<
  T extends TSchema & { properties: Record<string, TSchema> },
  PK extends string,
  const TS extends { createdAt?: string; updatedAt?: string }
>(
  schema: T,
  configure: (columns: ColumnRefs<T>) => TableConfigShape<PK, TS> & { timestamps: TS }
): TableDescriptor<T, PK, TS>;

/** @category Schema */
export function table<
  T extends TSchema & { properties: Record<string, TSchema> },
  PK extends string
>(
  schema: T,
  configure: (columns: ColumnRefs<T>) => TableConfigShape<PK, undefined>
): TableDescriptor<T, PK, undefined>;

/** @category Schema */
export function table<
  T extends TSchema & { properties: Record<string, TSchema> },
  PK extends string,
  TS extends TimestampConfig
>(
  schema: T,
  configure: (columns: ColumnRefs<T>) => TableConfigShape<PK, TS>
): TableDescriptor<T, PK, TS> {
  const columns = createColumnProxy(schema);
  const config = configure(columns);
  return { schema, ...config };
}
