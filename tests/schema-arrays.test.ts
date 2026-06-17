import { test, expect } from "bun:test";
import { Type } from "typebox";
import { introspectTable, buildColumns } from "../src/schema.ts";

const SchemaWithPrimitiveArrays = Type.Object({
  id: Type.Number(),
  tags: Type.Array(Type.String()),
  scores: Type.Array(Type.Number()),
});

test("arrays of primitives should get a scalar sub-table", () => {
  const meta = introspectTable("test", SchemaWithPrimitiveArrays);
  const tagsCol = meta.columns.find(c => c.name === "tags");
  const scoresCol = meta.columns.find(c => c.name === "scores");
  expect(tagsCol).toBeUndefined();
  expect(scoresCol).toBeUndefined();

  const tagsSub = meta.subTables.find(s => s.fieldName === "tags");
  expect(tagsSub).toBeDefined();
  expect(tagsSub?.isScalar).toBe(true);
  expect(tagsSub?.scalarType).toBe("TEXT");
  expect(tagsSub?.columns).toHaveLength(1);
  expect(tagsSub?.columns[0]?.name).toBe("_value");

  const scoresSub = meta.subTables.find(s => s.fieldName === "scores");
  expect(scoresSub).toBeDefined();
  expect(scoresSub?.isScalar).toBe(true);
  expect(scoresSub?.scalarType).toBe("REAL");
});

test("buildColumns handles arrays of primitives as TEXT", () => {
  const cols = buildColumns(SchemaWithPrimitiveArrays.properties);
  const tagsCol = cols.find(c => c.name === "tags");
  const scoresCol = cols.find(c => c.name === "scores");
  expect(tagsCol).toBeDefined();
  expect(tagsCol?.sqlType).toBe("TEXT");
  expect(scoresCol).toBeDefined();
  expect(scoresCol?.sqlType).toBe("TEXT");
});

test("optional primitive arrays produce nullable and optional true", () => {
  const schema = Type.Object({
    id: Type.Number(),
    tags: Type.Optional(Type.Array(Type.String())),
  });

  const cols = buildColumns(schema.properties);
  const tagsCol = cols.find(c => c.name === "tags");
  expect(tagsCol).toBeDefined();
  expect(tagsCol?.sqlType).toBe("TEXT");
  expect(tagsCol?.nullable).toBe(true);
  expect(tagsCol?.optional).toBe(true);

  const meta = introspectTable("test", schema);
  const metaTagsCol = meta.columns.find(c => c.name === "tags");
  expect(metaTagsCol).toBeUndefined();

  const tagsSub = meta.subTables.find(s => s.fieldName === "tags");
  expect(tagsSub).toBeDefined();
  expect(tagsSub?.isScalar).toBe(true);
  expect(tagsSub?.scalarType).toBe("TEXT");
});

test("arrays of booleans and integers are treated as scalar sub-tables", () => {
  const schema = Type.Object({
    id: Type.Number(),
    flags: Type.Array(Type.Boolean()),
    counts: Type.Array(Type.Integer()),
  });

  const cols = buildColumns(schema.properties);
  const flagsCol = cols.find(c => c.name === "flags");
  const countsCol = cols.find(c => c.name === "counts");
  expect(flagsCol).toBeDefined();
  expect(flagsCol?.sqlType).toBe("TEXT");
  expect(countsCol).toBeDefined();
  expect(countsCol?.sqlType).toBe("TEXT");

  const meta = introspectTable("test", schema);
  const metaFlagsCol = meta.columns.find(c => c.name === "flags");
  const metaCountsCol = meta.columns.find(c => c.name === "counts");
  expect(metaFlagsCol).toBeUndefined();
  expect(metaCountsCol).toBeUndefined();

  const flagsSub = meta.subTables.find(s => s.fieldName === "flags");
  expect(flagsSub).toBeDefined();
  expect(flagsSub?.isScalar).toBe(true);
  expect(flagsSub?.scalarType).toBe("INTEGER");

  const countsSub = meta.subTables.find(s => s.fieldName === "counts");
  expect(countsSub).toBeDefined();
  expect(countsSub?.isScalar).toBe(true);
  expect(countsSub?.scalarType).toBe("INTEGER");
});

test("nested objects and object arrays still produce expected columns", () => {
  const schema = Type.Object({
    id: Type.Number(),
    metadata: Type.Object({
      createdAt: Type.String(),
    }),
    lineItems: Type.Array(Type.Object({
      name: Type.String(),
      qty: Type.Integer(),
    })),
    tags: Type.Array(Type.String()),
  });

  const cols = buildColumns(schema.properties, [], 0, true);
  const metadataCol = cols.find(c => c.name === "metadata__createdAt");
  const tagsCol = cols.find(c => c.name === "tags");
  expect(metadataCol).toBeDefined();
  expect(metadataCol?.sqlType).toBe("TEXT");
  expect(tagsCol).toBeDefined();
  expect(tagsCol?.sqlType).toBe("TEXT");
  // lineItems should NOT appear as a column (it's a sub-table)
  const lineItemsCol = cols.find(c => c.name === "lineItems");
  expect(lineItemsCol).toBeUndefined();

  const meta = introspectTable("test", schema);
  const metaMetadataCol = meta.columns.find(c => c.name === "metadata__createdAt");
  const metaTagsCol = meta.columns.find(c => c.name === "tags");
  expect(metaMetadataCol).toBeDefined();
  expect(metaMetadataCol?.sqlType).toBe("TEXT");
  expect(metaTagsCol).toBeUndefined();

  const lineItemsSub = meta.subTables.find(s => s.fieldName === "lineItems");
  expect(lineItemsSub).toBeDefined();
  expect(lineItemsSub?.tableName).toBe("test__lineItems");
  expect(lineItemsSub?.columns.map(c => c.name)).toContain("name");
  expect(lineItemsSub?.columns.map(c => c.name)).toContain("qty");

  const tagsSub = meta.subTables.find(s => s.fieldName === "tags");
  expect(tagsSub).toBeDefined();
  expect(tagsSub?.isScalar).toBe(true);
  expect(tagsSub?.scalarType).toBe("TEXT");
});
