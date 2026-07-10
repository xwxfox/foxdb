/**
 * foxdb/src/table.ts
 * User-facing helper that wraps a schema + configuration into a descriptor.
 * Guarantees compile-time safety for PK and index columns via ColumnRef.
 */

import type { TObject, TSchema } from "typebox";
import type { ColumnRef, TScalarSchema, ColumnRefs } from "./columns.ts";
import { createColumnProxy } from "./columns.ts";
import type { IndexDefinition, TimestampConfig, FTSConfig, TableConfig, EvictionConfig, CompressionConfig, GeneratedColumnConfig } from "./types.ts";

/** @category Schema */
export interface SubTableConfig {
  indexes?: IndexDefinition[];
}

export interface TableDescriptor<
  T extends TSchema & { properties: Record<string, TSchema> },
  PK extends string,
  TS extends TimestampConfig = undefined,
  G extends GeneratedColumnConfig | undefined = undefined,
  F extends FTSConfig | undefined = undefined
> extends TableConfig<T, PK, TS, G, F> { }

export interface TableConfigShape<
  PK extends string,
  TS extends TimestampConfig,
  G extends GeneratedColumnConfig | undefined = undefined,
  F extends FTSConfig | undefined = undefined
> {
  primaryKey: ColumnRef<PK>;
  indexes?: IndexDefinition[];
  subTables?: Partial<Record<string, SubTableConfig>>;
  timestamps?: TS;
  eviction?: EvictionConfig;
  compression?: CompressionConfig;
  softDelete?: import("./types.ts").SoftDeleteConfig;
  generated?: G;
  fts?: F;
  /** Auto-index TEXT columns on sub-tables. Defaults to true. Set false to disable. */
  autoIndex?: boolean;
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
  TS extends TimestampConfig = undefined,
  G extends GeneratedColumnConfig | undefined = undefined,
  F extends FTSConfig | undefined = undefined
>(
  schema: T,
  configure: (columns: ColumnRefs<T>) => TableConfigShape<PK, TS, G, F>
): TableDescriptor<T, PK, TS, G, F> {
  const columns = createColumnProxy(schema);
  const config = configure(columns) as TableConfigShape<PK, TS, G, F>;
  const out = { schema, ...config } satisfies TableDescriptor<T, PK, TS, G, F>;
  return out;
}