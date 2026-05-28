import { test, expect } from "bun:test";
import { buildWhere } from "../src/query-builder.ts";
import { Type } from "typebox";

const SchemaWithArrays = Type.Object({
  id: Type.Number(),
  tags: Type.Array(Type.String()),
  scores: Type.Array(Type.Number()),
  metadata: Type.Object({
    labels: Type.Array(Type.String())
  })
});

test("arraySome SQL generation", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    tags: { arraySome: "ts" }
  });
  expect(result.sql).toBe('WHERE EXISTS (SELECT 1 FROM json_each("tags") WHERE value = ?)');
  expect(result.params).toEqual(["ts"]);
});

test("arrayNot SQL generation", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    tags: { arrayNot: "js" }
  });
  expect(result.sql).toBe('WHERE NOT EXISTS (SELECT 1 FROM json_each("tags") WHERE value = ?)');
  expect(result.params).toEqual(["js"]);
});

test("isEmpty: true SQL generation", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    tags: { isEmpty: true }
  });
  expect(result.sql).toBe('WHERE (json_array_length("tags") = 0 OR "tags" IS NULL)');
  expect(result.params).toEqual([]);
});

test("isEmpty: false SQL generation", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    tags: { isEmpty: false }
  });
  expect(result.sql).toBe('WHERE json_array_length("tags") > 0');
  expect(result.params).toEqual([]);
});

test("nested array filter SQL generation", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    "metadata.labels": { arraySome: "important" }
  });
  // Note: resolveJsonColumn will handle the dotted path
  expect(result.sql).toBe(`WHERE EXISTS (SELECT 1 FROM json_each(JSON_EXTRACT("metadata", '$.labels')) WHERE value = ?)`);
  expect(result.params).toEqual(["important"]);
});

test("array equality (whole array)", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    tags: { eq: ["a", "b"] }
  });
  expect(result.sql).toBe('WHERE "tags" = ?');
  expect(result.params).toEqual(['["a","b"]']);
});

test("array of numbers", () => {
  const result = buildWhere<typeof SchemaWithArrays>({
    scores: { arraySome: 100 }
  });
  expect(result.sql).toBe('WHERE EXISTS (SELECT 1 FROM json_each("scores") WHERE value = ?)');
  expect(result.params).toEqual([100]);
});
