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
  IsObject,
  IsOptional,
  type TObject,
  type TString,
  type TNumber,
  type TInteger,
  type TBoolean,
  type TLiteral,
  type TSchema,
  type TProperties,
  type TOptional,
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

type UnwrapOptionalSchema<S extends TSchema> = S extends TOptional<infer U> ? U : S;

type IsScalarSchema<S extends TSchema> =
  S extends TString ? true
  : S extends TNumber ? true
  : S extends TInteger ? true
  : S extends TBoolean ? true
  : S extends TLiteral<string | number | boolean> ? true
  : false;

type NestedColumnKeys<T extends TSchema & { properties: Record<string, TSchema> }> = {
  [K in keyof T["properties"] & string]: UnwrapOptionalSchema<T["properties"][K]> extends TObject<infer P>
    ? {
        [K2 in keyof P & string]: IsScalarSchema<UnwrapOptionalSchema<P[K2]>> extends true
          ? `${K}__${K2}`
          : UnwrapOptionalSchema<P[K2]> extends TObject<infer P2>
            ? {
                [K3 in keyof P2 & string]: IsScalarSchema<UnwrapOptionalSchema<P2[K3]>> extends true ? `${K}__${K2}__${K3}` : never
              }[keyof P2 & string]
            : never
      }[keyof P & string]
    : never;
}[keyof T["properties"] & string];

type NestedColumnRef<T extends TSchema & { properties: Record<string, TSchema> }, N extends string> =
  N extends `${infer K}__${infer K2}__${infer K3}`
    ? K extends keyof T["properties"] & string
      ? UnwrapOptionalSchema<T["properties"][K]> extends TObject<infer P>
        ? K2 extends keyof P & string
          ? UnwrapOptionalSchema<P[K2]> extends TObject<infer P2>
            ? K3 extends keyof P2 & string
              ? UnwrapOptionalSchema<P2[K3]> extends infer U
                ? U extends TScalarSchema
                  ? ColumnRef<N, U>
                  : never
                : never
              : never
            : never
          : never
        : never
      : never
    : N extends `${infer K}__${infer K2}`
    ? K extends keyof T["properties"] & string
      ? UnwrapOptionalSchema<T["properties"][K]> extends TObject<infer P>
        ? K2 extends keyof P & string
          ? UnwrapOptionalSchema<P[K2]> extends infer U
            ? U extends TScalarSchema
              ? ColumnRef<N, U>
              : never
            : never
          : never
        : never
      : never
    : never;

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
} & {
  readonly [K in NestedColumnKeys<T>]: NestedColumnRef<T, K>;
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

function unwrapOptionalRuntime(schema: TSchema): TSchema {
  if (IsOptional(schema)) {
    const copy = { ...(schema as any) };
    delete copy["~optional"];
    return copy as TSchema;
  }
  return schema;
}

/** @internal */
export function createColumnProxy<T extends TSchema & { properties: Record<string, TSchema> }>(schema: T): ColumnRefs<T> {
  const proxy: Record<string, ColumnRef<string, TScalarSchema>> = {};
  for (const key of Object.keys(schema.properties)) {
    const prop = schema.properties[key];
    if (prop && isScalarSchema(prop)) {
      proxy[key] = { _tag: "ColumnRef", name: key, schema: prop };
    }

    if (prop) {
      const objProp = unwrapOptionalRuntime(prop);
      if (objProp && IsObject(objProp)) {
        const props = (objProp as any).properties as Record<string, TSchema>;
        for (const nestedKey of Object.keys(props)) {
          const nestedProp = props[nestedKey];
          if (nestedProp) {
            const scalarProp = unwrapOptionalRuntime(nestedProp);
            if (isScalarSchema(scalarProp)) {
              const flatName = `${key}__${nestedKey}`;
              proxy[flatName] = { _tag: "ColumnRef", name: flatName, schema: scalarProp };
            }

            const nestedObjProp = unwrapOptionalRuntime(nestedProp);
            if (nestedObjProp && IsObject(nestedObjProp)) {
              const nestedProps = (nestedObjProp as any).properties as Record<string, TSchema>;
              for (const deepKey of Object.keys(nestedProps)) {
                const deepProp = nestedProps[deepKey];
                if (deepProp) {
                  const deepScalar = unwrapOptionalRuntime(deepProp);
                  if (isScalarSchema(deepScalar)) {
                    const deepFlatName = `${key}__${nestedKey}__${deepKey}`;
                    proxy[deepFlatName] = { _tag: "ColumnRef", name: deepFlatName, schema: deepScalar };
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return proxy as ColumnRefs<T>;
}