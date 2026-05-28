import { test, expect } from "bun:test";
import { buildWhere } from "../src/query-builder.ts";
import { Type } from "typebox";

const SchemaWithArrays = Type.Object({
  id: Type.Number(),
  tags: Type.Array(Type.String()),
  scores: Type.Array(Type.Number()),
});

test("fastArrayIsEmpty: true SQL generation", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    tags: { fastArrayIsEmpty: true }
  });
  expect(result.sql).toBe('WHERE ("tags" = \'[]\' OR "tags" IS NULL)');
});

test("fastArrayIsEmpty: false SQL generation", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    tags: { fastArrayIsEmpty: false }
  });
  expect(result.sql).toBe('WHERE ("tags" != \'[]\' AND "tags" IS NOT NULL)');
});

test("fastArraySome SQL generation (string)", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    tags: { fastArraySome: "typescript" }
  });
  // Should wrap the search term in quotes and commas
  expect(result.sql).toBe('WHERE (\',\' || REPLACE(REPLACE("tags", \'[\', \'\'), \']\', \'\') || \',\') LIKE ?');
  expect(result.params).toEqual(['%,"typescript",%']);
});

test("fastArraySome SQL generation (number)", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    scores: { fastArraySome: 42 }
  });
  // Numbers are not quoted in JSON
  expect(result.params).toEqual(['%,42,%']);
});

test("fastArraySome with escaped characters", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    tags: { fastArraySome: 'part"123' }
  });
  // JSON.stringify handles the escape sequence
  expect(result.params).toEqual(['%,"part\\"123",%']);
});

test("fastArrayNot SQL generation", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    tags: { fastArrayNot: "javascript" }
  });
  expect(result.sql).toBe('WHERE (\',\' || REPLACE(REPLACE("tags", \'[\', \'\'), \']\', \'\') || \',\') NOT LIKE ?');
  expect(result.params).toEqual(['%,"javascript",%']);
});

test("fastArraySome with special characters in string", () => {
    const result = buildWhere<typeof SchemaWithArrays>({
      tags: { fastArraySome: "a,b[c]d" }
    });
    // JSON stringifies special chars
    expect(result.params).toEqual(['%,"a,b[c]d",%']);
  });
