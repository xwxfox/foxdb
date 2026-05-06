import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

export function StrictObject<T extends Record<string, TSchema>>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}

export function toDate(value: DateValue): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

export function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

export const DateValueSchema = Type.Union([
  Type.String({ format: "date-time" }),
  Type.Unsafe<Date>(Date)
])
export type DateValue = Static<typeof DateValueSchema>;

export const NullableStringSchema = Type.Union([Type.String(), Type.Null()]);
export const NullableNumberSchema = Type.Union([Type.Number(), Type.Null()]);
export const StringKeyValueSchema = StrictObject({ key: Type.String(), value: Type.String() });

export type ParseSuccess<T> = { ok: true; value: T };
export type ParseFailure = { ok: false; error: Error };
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export function checkWithSchema<T extends TSchema>(schema: T, input: unknown): input is Static<T> {
  return Value.Check(schema, input);
}

export function parseWithSchema<T extends TSchema>(schema: T, input: unknown, name = "value"): ParseResult<Static<T>> {
  const converted = Value.Convert(schema, input);
  const cleaned = Value.Clean(schema, converted);

  if (Value.Check(schema, cleaned)) {
    return { ok: true, value: cleaned as Static<T> };
  }

  const firstError = [...Value.Errors(schema, cleaned)][0];
  const message = firstError ? `${name}: ${firstError.schemaPath || "/"} ${firstError.message}` : `${name}: invalid payload`;

  return {
    ok: false,
    error: new Error(message),
  };
}

export function parseWithSchemaOrThrow<T extends TSchema>(schema: T, input: unknown, name = "value"): Static<T> {
  const result = parseWithSchema(schema, input, name);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}
