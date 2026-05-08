import { test, expect } from "bun:test";
import { Type } from "typebox";
import { introspectTable, buildColumns } from "../src/schema.ts";

const SchemaWithPrimitiveArrays = Type.Object({
  id: Type.Number(),
  tags: Type.Array(Type.String()),
  scores: Type.Array(Type.Number()),
});

test("arrays of primitives should get a TEXT column", () => {
  const meta = introspectTable("test", SchemaWithPrimitiveArrays);
  const tagsCol = meta.columns.find(c => c.name === "tags");
  const scoresCol = meta.columns.find(c => c.name === "scores");
  expect(tagsCol).toBeDefined();
  expect(tagsCol?.sqlType).toBe("TEXT");
  expect(scoresCol).toBeDefined();
  expect(scoresCol?.sqlType).toBe("TEXT");
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
  expect(metaTagsCol).toBeDefined();
  expect(metaTagsCol?.sqlType).toBe("TEXT");
  expect(metaTagsCol?.nullable).toBe(true);
  expect(metaTagsCol?.optional).toBe(true);
});

test("arrays of booleans and integers are treated as TEXT", () => {
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
  expect(metaFlagsCol).toBeDefined();
  expect(metaFlagsCol?.sqlType).toBe("TEXT");
  expect(metaCountsCol).toBeDefined();
  expect(metaCountsCol?.sqlType).toBe("TEXT");
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
  expect(metaTagsCol).toBeDefined();
  expect(metaTagsCol?.sqlType).toBe("TEXT");

  const subTable = meta.subTables.find(s => s.fieldName === "lineItems");
  expect(subTable).toBeDefined();
  expect(subTable?.tableName).toBe("test__lineItems");
  expect(subTable?.columns.map(c => c.name)).toContain("name");
  expect(subTable?.columns.map(c => c.name)).toContain("qty");
});
