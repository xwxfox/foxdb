/**
 * foxdb/src/columns.ts
 * Builds a typed proxy from a TypeBox TObject so that schema.sku returns
 * a ColumnRef whose type encodes the exact column name.
 */

import {
  IsString,
  IsNumber,
  IsInteger,
  IsBoolean,
  IsLiteral,
  type TObject,
  type TString,
  type TNumber,
  type TInteger,
  type TBoolean,
  type TLiteral,
  type TSchema,
} from "typebox";


/** @category Schema */
export type TScalarSchema =
  | TString
  | TNumber
  | TInteger
  | TBoolean
  | TLiteral<string>
  | TLiteral<number>
  | TLiteral<boolean>;

/**
 * typed reference to a scalar column
 * @category Schema
 */
export interface ColumnRef<N extends string = string, S extends TScalarSchema = TScalarSchema> {
  readonly _tag: "ColumnRef";
  readonly name: N;
  readonly schema: S;
}

/**
 * map of scalar columns to their typed refs
 * @category Schema
 */
export type ColumnRefs<T extends TSchema & { properties: Record<string, TSchema> }> = {
  readonly [K in keyof T["properties"]as T["properties"][K] extends TScalarSchema
  ? K
  : never]: T["properties"][K] extends TScalarSchema
  ? ColumnRef<K & string, T["properties"][K]>
  : never;
};

/** @internal */
function isScalarSchema(prop: TSchema): prop is TScalarSchema {
  return (
    IsString(prop) ||
    IsNumber(prop) ||
    IsInteger(prop) ||
    IsBoolean(prop) ||
    IsLiteral(prop)
  );
}

/** @internal */
export function createColumnProxy<T extends TSchema & { properties: Record<string, TSchema> }>(schema: T): ColumnRefs<T> {
  const proxy: Record<string, ColumnRef<string, TScalarSchema>> = {};
  for (const key of Object.keys(schema.properties)) {
    const prop = schema.properties[key];
    if (prop && isScalarSchema(prop)) {
      proxy[key] = { _tag: "ColumnRef", name: key, schema: prop };
    }
  }
  return proxy as ColumnRefs<T>;
}
