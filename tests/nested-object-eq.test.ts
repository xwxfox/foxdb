import { test, expect } from "bun:test";
import { Type } from "typebox";
import { createORM, table } from "../src/index.ts";

const NestedSchema = Type.Object({
  id: Type.Number(),
  pricing: Type.Object({ total: Type.Number(), currency: Type.String() }),
  status: Type.Object({ group: Type.String(), blocked: Type.Boolean() }),
});

function makeORM() {
  return createORM({
    path: ":memory:",
    rebuildOnLaunch: true,
    tables: {
      nested: table(NestedSchema, (s) => ({ primaryKey: s.id })),
    },
  });
}

test("flattened dotted path eq filter returns matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });

  const results = orm.nested.findMany({
    where: { AND: [{ "pricing.total": { eq: 100 } }, { "pricing.currency": { eq: "DKK" } }] },
  });

  expect(results).toHaveLength(1);
  expect(results[0]!.id).toBe(1);
  orm._close();
});

test("flattened dotted path ne filter returns non-matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });

  const results = orm.nested.findMany({
    where: { OR: [{ "pricing.total": { ne: 100 } }, { "pricing.currency": { ne: "DKK" } }] },
  });

  expect(results).toHaveLength(1);
  expect(results[0]!.id).toBe(2);
  orm._close();
});

test("dotted path eq filter returns matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });

  const results = orm.nested.findMany({
    where: { "pricing.total": { eq: 100 } },
  });

  expect(results).toHaveLength(1);
  expect(results[0]!.id).toBe(1);
  orm._close();
});

test("dotted path gt filter returns matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });
  orm.nested.insert({
    id: 3,
    pricing: { total: 50, currency: "USD" },
    status: { group: "pending", blocked: false },
  });

  const results = orm.nested.findMany({
    where: { "pricing.total": { gt: 75 } },
  });

  expect(results).toHaveLength(2);
  expect(results.map((r) => r.id).sort()).toEqual([1, 2]);
  orm._close();
});

test("dotted path like filter returns matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });

  const results = orm.nested.findMany({
    where: { "status.group": { like: "act%" } },
  });

  expect(results).toHaveLength(1);
  expect(results[0]!.id).toBe(1);
  orm._close();
});

test("dotted path in filter returns matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });
  orm.nested.insert({
    id: 3,
    pricing: { total: 50, currency: "USD" },
    status: { group: "pending", blocked: false },
  });

  const results = orm.nested.findMany({
    where: { "pricing.currency": { in: ["DKK", "EUR"] } },
  });

  expect(results).toHaveLength(2);
  expect(results.map((r) => r.id).sort()).toEqual([1, 2]);
  orm._close();
});

test("dotted path ne filter returns non-matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });

  const results = orm.nested.findMany({
    where: { "pricing.currency": { ne: "DKK" } },
  });

  expect(results).toHaveLength(1);
  expect(results[0]!.id).toBe(2);
  orm._close();
});

test("dotted path gte filter returns matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });
  orm.nested.insert({
    id: 3,
    pricing: { total: 50, currency: "USD" },
    status: { group: "pending", blocked: false },
  });

  const results = orm.nested.findMany({
    where: { "pricing.total": { gte: 100 } },
  });

  expect(results).toHaveLength(2);
  expect(results.map((r) => r.id).sort()).toEqual([1, 2]);
  orm._close();
});

test("dotted path lt filter returns matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });
  orm.nested.insert({
    id: 3,
    pricing: { total: 50, currency: "USD" },
    status: { group: "pending", blocked: false },
  });

  const results = orm.nested.findMany({
    where: { "pricing.total": { lt: 100 } },
  });

  expect(results).toHaveLength(1);
  expect(results[0]!.id).toBe(3);
  orm._close();
});
