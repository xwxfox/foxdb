import { test, expect } from "bun:test";
import { Type } from "typebox";
import { buildWhere } from "../src/query-builder.ts";

const NestedSchema = Type.Object({
  id: Type.Number(),
  pricing: Type.Object({
    total: Type.Number(),
    currency: Type.String(),
  }),
  status: Type.Object({
    group: Type.String(),
    blocked: Type.Boolean(),
  }),
});

test("JSON_EXTRACT for nested object path", () => {
  const result = buildWhere<typeof NestedSchema>({
    "pricing.total": { gt: 100 }
  });
  expect(result.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') > ?');
  expect(result.params).toEqual([100]);
});

test("JSON_EXTRACT for deeply nested path", () => {
  const result = buildWhere<typeof NestedSchema>({
    "status.group": { eq: "active" }
  });
  expect(result.sql).toBe('WHERE JSON_EXTRACT("status", \'$.group\') = ?');
  expect(result.params).toEqual(["active"]);
});

test("JSON_EXTRACT works with all filter operators", () => {
  const eqResult = buildWhere<typeof NestedSchema>({ "pricing.currency": { eq: "DKK" } });
  expect(eqResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.currency\') = ?');
  expect(eqResult.params).toEqual(["DKK"]);

  const neResult = buildWhere<typeof NestedSchema>({ "pricing.currency": { ne: "EUR" } });
  expect(neResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.currency\') != ?');
  expect(neResult.params).toEqual(["EUR"]);

  const gteResult = buildWhere<typeof NestedSchema>({ "pricing.total": { gte: 50 } });
  expect(gteResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') >= ?');
  expect(gteResult.params).toEqual([50]);

  const ltResult = buildWhere<typeof NestedSchema>({ "pricing.total": { lt: 200 } });
  expect(ltResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') < ?');
  expect(ltResult.params).toEqual([200]);

  const lteResult = buildWhere<typeof NestedSchema>({ "pricing.total": { lte: 200 } });
  expect(lteResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') <= ?');
  expect(lteResult.params).toEqual([200]);

  const likeResult = buildWhere<typeof NestedSchema>({ "status.group": { like: "%active%" } });
  expect(likeResult.sql).toBe('WHERE JSON_EXTRACT("status", \'$.group\') LIKE ?');
  expect(likeResult.params).toEqual(["%active%"]);

  const betweenResult = buildWhere<typeof NestedSchema>({ "pricing.total": { between: [10, 100] } });
  expect(betweenResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') BETWEEN ? AND ?');
  expect(betweenResult.params).toEqual([10, 100]);

  const inResult = buildWhere<typeof NestedSchema>({ "pricing.currency": { in: ["DKK", "EUR"] } });
  expect(inResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.currency\') IN (?, ?)');
  expect(inResult.params).toEqual(["DKK", "EUR"]);

  const notInResult = buildWhere<typeof NestedSchema>({ "pricing.currency": { notIn: ["USD"] } });
  expect(notInResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.currency\') NOT IN (?)');
  expect(notInResult.params).toEqual(["USD"]);

  const isNullResult = buildWhere<typeof NestedSchema>({ "pricing.total": { isNull: true } });
  expect(isNullResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') IS NULL');
  expect(isNullResult.params).toEqual([]);

  const isNotNullResult = buildWhere<typeof NestedSchema>({ "pricing.total": { isNotNull: true } });
  expect(isNotNullResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') IS NOT NULL');
  expect(isNotNullResult.params).toEqual([]);
});

test("JSON_EXTRACT combined with regular column filters", () => {
  const result = buildWhere<typeof NestedSchema>({
    id: { eq: 1 },
    "pricing.total": { gt: 100 }
  });
  expect(result.sql).toBe('WHERE "id" = ? AND JSON_EXTRACT("pricing", \'$.total\') > ?');
  expect(result.params).toEqual([1, 100]);
});

test("JSON_EXTRACT inside logical operators", () => {
  const result = buildWhere<typeof NestedSchema>({
    AND: [
      { "pricing.total": { gt: 100 } },
      { "status.group": { eq: "active" } }
    ]
  });
  expect(result.sql).toBe('WHERE (JSON_EXTRACT("pricing", \'$.total\') > ?) AND (JSON_EXTRACT("status", \'$.group\') = ?)');
  expect(result.params).toEqual([100, "active"]);
});

test("JSON_EXTRACT inside OR with dotted paths", () => {
  const result = buildWhere<typeof NestedSchema>({
    OR: [
      { "pricing.total": { gt: 100 } },
      { "status.group": { eq: "active" } }
    ]
  });
  expect(result.sql).toBe('WHERE (JSON_EXTRACT("pricing", \'$.total\') > ? OR JSON_EXTRACT("status", \'$.group\') = ?)');
  expect(result.params).toEqual([100, "active"]);
});

test("JSON_EXTRACT inside NOT with dotted path", () => {
  const result = buildWhere<typeof NestedSchema>({
    NOT: { "pricing.total": { gt: 100 } }
  });
  expect(result.sql).toBe('WHERE NOT (JSON_EXTRACT("pricing", \'$.total\') > ?)');
  expect(result.params).toEqual([100]);
});
