import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number, Boolean, Optional, Array } from "typebox";
import { createORM, table } from "../src/index.ts";
import { buildWhere } from "../src/query-builder.ts";
import { introspectTable } from "../src/schema.ts";

const LineItemSchema = Object({
  sku: String(),
  qty: Number(),
});

const TestSchema = Object({
  id: Number(),
  status: Object({
    group: String(),
    blocked: Optional(Boolean()),
  }),
  pricing: Object({
    total: Number(),
    currency: String(),
    discount: Object({
      amount: Number(),
      code: String(),
      meta: Optional(Object({
        source: String(),
      })),
    }),
  }),
  tags: Array(String()),
  items: Array(LineItemSchema),
});

function makeORM() {
  return createORM({
    path: ":memory:",
    rebuildOnLaunch: true,
    tables: {
      test: table(TestSchema, (s) => ({ primaryKey: s.id })),
    },
  });
}

describe("nested object flattening", () => {
  test("schema introspection creates flattened columns", () => {
    const meta = introspectTable("test", TestSchema);
    const colMap = new Map(meta.columns.map((c) => [c.name, c]));

    expect(colMap.get("id")!.sqlType).toBe("REAL");
    expect(colMap.get("status__group")!.sqlType).toBe("TEXT");
    expect(colMap.get("status__group")!.nullable).toBe(false);
    expect(colMap.get("status__blocked")!.sqlType).toBe("INTEGER");
    expect(colMap.get("status__blocked")!.nullable).toBe(true);
    expect(colMap.get("status__blocked")!.isBoolean).toBe(true);
    expect(colMap.get("pricing__total")!.sqlType).toBe("REAL");
    expect(colMap.get("pricing__currency")!.sqlType).toBe("TEXT");

    // Depth-2 scalar columns are flattened
    expect(colMap.get("pricing__discount__amount")!.sqlType).toBe("REAL");
    expect(colMap.get("pricing__discount__code")!.sqlType).toBe("TEXT");

    // Depth-3 object stays as JSON TEXT column
    expect(colMap.get("pricing__discount__meta")!.sqlType).toBe("TEXT");
    expect(colMap.get("pricing__discount__meta")!.nullable).toBe(true);
    expect(colMap.get("pricing__discount__meta")!.path).toEqual(["pricing", "discount", "meta"]);

    // Array of primitives stays JSON
    expect(colMap.get("tags")!.sqlType).toBe("TEXT");

    // Sub-table for items
    expect(meta.subTables).toHaveLength(1);
    expect(meta.subTables[0]!.tableName).toBe("test__items");
  });

  test("insert roundtrip preserves nested objects", () => {
    const orm = makeORM();
    const inserted = orm.test.insert({
      id: 1,
      status: { group: "PNP", blocked: false },
      pricing: { total: 150, currency: "USD", discount: { amount: 10, code: "SAVE10", meta: { source: "test" } } },
      tags: ["a", "b"],
      items: [{ sku: "X", qty: 2 }],
    });

    expect(inserted.status.group).toBe("PNP");
    expect(inserted.status.blocked).toBe(false);
    expect(inserted.pricing.total).toBe(150);
    expect(inserted.pricing.currency).toBe("USD");
    expect(inserted.pricing.discount.amount).toBe(10);
    expect(inserted.pricing.discount.code).toBe("SAVE10");
    expect(inserted.tags).toEqual(["a", "b"]);
    expect(inserted.items).toHaveLength(1);

    const found = orm.test.findById(1);
    expect(found).not.toBeNull();
    expect(found!.status.group).toBe("PNP");
    expect(found!.status.blocked).toBe(false);
    expect(found!.pricing.total).toBe(150);
    expect(found!.pricing.currency).toBe("USD");
    expect(found!.pricing.discount).toEqual({ amount: 10, code: "SAVE10", meta: { source: "test" } });
    expect(found!.tags).toEqual(["a", "b"]);
    expect(found!.items).toHaveLength(1);
    expect(found!.items[0]!.sku).toBe("X");
    expect(found!.items[0]!.qty).toBe(2);

    orm._close();
  });

  test("query by dotted path uses flattened column", () => {
    const orm = makeORM();
    orm.test.insert({
      id: 1,
      status: { group: "PNP" },
      pricing: { total: 100, currency: "DKK", discount: { amount: 5, code: "SAVE5", meta: { source: "test" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 2,
      status: { group: "PNP" },
      pricing: { total: 200, currency: "EUR", discount: { amount: 15, code: "SAVE15", meta: { source: "test" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 3,
      status: { group: "PUP" },
      pricing: { total: 50, currency: "USD", discount: { amount: 0, code: "NONE", meta: { source: "test" } } },
      tags: [],
      items: [],
    });

    const meta = introspectTable("test", TestSchema);
    const whereResult = buildWhere<typeof TestSchema>(
      { "status.group": { eq: "PNP" } },
      undefined,
      meta
    );
    expect(whereResult.sql).toBe('WHERE "status__group" = ?');
    expect(whereResult.params).toEqual(["PNP"]);

    const results = orm.test.findMany({
      where: { "status.group": { eq: "PNP" } },
    });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id).sort()).toEqual([1, 2]);

    orm._close();
  });

  test("query by depth-2 dotted path uses flattened column", () => {
    const orm = makeORM();
    orm.test.insert({
      id: 1,
      status: { group: "PNP" },
      pricing: { total: 100, currency: "DKK", discount: { amount: 5, code: "SAVE5", meta: { source: "test" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 2,
      status: { group: "PNP" },
      pricing: { total: 200, currency: "EUR", discount: { amount: 15, code: "SAVE15", meta: { source: "test" } } },
      tags: [],
      items: [],
    });

    const meta = introspectTable("test", TestSchema);
    const whereResult = buildWhere<typeof TestSchema>(
      { "pricing.total": { gt: 100 } },
      undefined,
      meta
    );
    expect(whereResult.sql).toBe('WHERE "pricing__total" > ?');
    expect(whereResult.params).toEqual([100]);

    const results = orm.test.findMany({
      where: { "pricing.total": { gt: 100 } },
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(2);

    orm._close();
  });

  test("query by depth-3 dotted path still uses JSON_EXTRACT", () => {
    const orm = makeORM();
    orm.test.insert({
      id: 1,
      status: { group: "PNP" },
      pricing: { total: 100, currency: "DKK", discount: { amount: 10, code: "SAVE10", meta: { source: "web" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 2,
      status: { group: "PNP" },
      pricing: { total: 200, currency: "EUR", discount: { amount: 20, code: "SAVE20", meta: { source: "api" } } },
      tags: [],
      items: [],
    });

    const meta = introspectTable("test", TestSchema);
    const whereResult = buildWhere<typeof TestSchema>(
      { "pricing.discount.meta.source": { eq: "web" } },
      undefined,
      meta
    );
    expect(whereResult.sql).toBe(
      'WHERE JSON_EXTRACT("pricing__discount__meta", \'$.source\') = ?'
    );
    expect(whereResult.params).toEqual(["web"]);

    const results = orm.test.findMany({
      where: { "pricing.discount.meta.source": { eq: "web" } },
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(1);

    orm._close();
  });

  test("optional nested fields are null when missing", () => {
    const orm = makeORM();
    orm.test.insert({
      id: 1,
      status: { group: "PNP" },
      pricing: { total: 100, currency: "DKK", discount: { amount: 5, code: "SAVE5", meta: { source: "test" } } },
      tags: [],
      items: [],
    });

    const found = orm.test.findById(1);
    expect(found).not.toBeNull();
    expect(found!.status.blocked).toBeNull();

    orm._close();
  });

  test("index on flattened column works", () => {
    const orm = createORM({
      path: ":memory:",
      rebuildOnLaunch: true,
      tables: {
        test: table(TestSchema, (s) => ({
          primaryKey: s.id,
          indexes: [{ columns: [s.status__group] }],
        })),
      },
    });

    orm.test.insert({
      id: 1,
      status: { group: "PNP" },
      pricing: { total: 100, currency: "DKK", discount: { amount: 5, code: "SAVE5", meta: { source: "test" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 2,
      status: { group: "PNP" },
      pricing: { total: 200, currency: "EUR", discount: { amount: 15, code: "SAVE15", meta: { source: "test" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 3,
      status: { group: "PUP" },
      pricing: { total: 50, currency: "USD", discount: { amount: 0, code: "NONE", meta: { source: "test" } } },
      tags: [],
      items: [],
    });

    const results = orm.test.findMany({
      where: { "status.group": { eq: "PNP" } },
    });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id).sort()).toEqual([1, 2]);

    const idxs = orm.test.raw(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'test'`
    );
    expect(
      idxs.some((r: any) => r.name.includes("status__group"))
    ).toBe(true);

    orm._close();
  });

  test("sub-table unchanged", () => {
    const orm = makeORM();
    orm.test.insert({
      id: 1,
      status: { group: "PNP" },
      pricing: { total: 100, currency: "DKK", discount: { amount: 5, code: "SAVE5", meta: { source: "test" } } },
      tags: ["a"],
      items: [
        { sku: "X", qty: 2 },
        { sku: "Y", qty: 3 },
      ],
    });

    const results = orm.test.findMany({ include: ["items"] });
    expect(results).toHaveLength(1);
    expect(results[0]!.items).toHaveLength(2);
    expect(results[0]!.items[0]!.sku).toBe("X");
    expect(results[0]!.items[0]!.qty).toBe(2);
    expect(results[0]!.items[1]!.sku).toBe("Y");
    expect(results[0]!.items[1]!.qty).toBe(3);

    orm._close();
  });

  test("update nested flattened fields", () => {
    const orm = makeORM();
    orm.test.insert({
      id: 1,
      status: { group: "PNP" },
      pricing: { total: 100, currency: "DKK", discount: { amount: 5, code: "SAVE5", meta: { source: "test" } } },
      tags: [],
      items: [],
    });

    const updated = orm.test.update({ id: 1, status: { group: "PUP" } });
    expect(updated).not.toBeNull();
    expect(updated!.status.group).toBe("PUP");

    const found = orm.test.findById(1);
    expect(found).not.toBeNull();
    expect(found!.status.group).toBe("PUP");
    // Other nested fields should be preserved
    expect(found!.pricing.total).toBe(100);

    orm._close();
  });

  test("mixed WHERE with flat and JSON columns", () => {
    const orm = makeORM();
    orm.test.insert({
      id: 1,
      status: { group: "PNP" },
      pricing: { total: 100, currency: "DKK", discount: { amount: 10, code: "SAVE10", meta: { source: "test" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 2,
      status: { group: "PNP" },
      pricing: { total: 200, currency: "EUR", discount: { amount: 10, code: "SAVE20", meta: { source: "test" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 3,
      status: { group: "PUP" },
      pricing: { total: 50, currency: "USD", discount: { amount: 10, code: "SAVE10", meta: { source: "test" } } },
      tags: [],
      items: [],
    });

    const results = orm.test.findMany({
      where: {
        "status.group": { eq: "PNP" },
        "pricing.discount.code": { eq: "SAVE10" },
      },
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(1);

    orm._close();
  });

  test("select dotted path returns correct nested shape", () => {
    const orm = makeORM();
    orm.test.insert({
      id: 1,
      status: { group: "PNP", blocked: false },
      pricing: { total: 100, currency: "DKK", discount: { amount: 5, code: "SAVE5", meta: { source: "test" } } },
      tags: ["a"],
      items: [],
    });

    const results = orm.test.findMany({
      select: ["status.group", "pricing.total"],
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toEqual({ group: "PNP" });
    expect(results[0]!.pricing).toEqual({ total: 100 });
    expect((results[0]! as any).id).toBeUndefined();

    orm._close();
  });

  test("select top-level object returns full nested object", () => {
    const orm = makeORM();
    orm.test.insert({
      id: 1,
      status: { group: "PNP", blocked: false },
      pricing: { total: 100, currency: "DKK", discount: { amount: 5, code: "SAVE5", meta: { source: "test" } } },
      tags: ["a"],
      items: [],
    });

    const results = orm.test.findMany({
      select: ["status"],
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toEqual({ group: "PNP", blocked: false });
    expect((results[0]! as any).id).toBeUndefined();

    orm._close();
  });

  test("orderBy dotted path sorts correctly", () => {
    const orm = makeORM();
    orm.test.insert({
      id: 1,
      status: { group: "PNP" },
      pricing: { total: 300, currency: "DKK", discount: { amount: 5, code: "SAVE5", meta: { source: "test" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 2,
      status: { group: "PNP" },
      pricing: { total: 100, currency: "EUR", discount: { amount: 15, code: "SAVE15", meta: { source: "test" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 3,
      status: { group: "PUP" },
      pricing: { total: 200, currency: "USD", discount: { amount: 0, code: "NONE", meta: { source: "test" } } },
      tags: [],
      items: [],
    });

    const results = orm.test.findMany({
      orderBy: { column: "pricing.total", direction: "ASC" },
    });
    expect(results.map((r) => r.id)).toEqual([2, 3, 1]);

    orm._close();
  });

  test("aggregate with dotted path groupBy", () => {
    const orm = makeORM();
    orm.test.insert({
      id: 1,
      status: { group: "PNP" },
      pricing: { total: 100, currency: "DKK", discount: { amount: 5, code: "SAVE5", meta: { source: "test" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 2,
      status: { group: "PNP" },
      pricing: { total: 200, currency: "EUR", discount: { amount: 15, code: "SAVE15", meta: { source: "test" } } },
      tags: [],
      items: [],
    });
    orm.test.insert({
      id: 3,
      status: { group: "PUP" },
      pricing: { total: 50, currency: "USD", discount: { amount: 0, code: "NONE", meta: { source: "test" } } },
      tags: [],
      items: [],
    });

    const results = orm.test.aggregate({
      groupBy: ["status.group"],
      aggregations: { totalSum: { sum: "pricing.total" }, count: { count: "*" } },
    });
    expect(results).toHaveLength(2);
    const pnp = results.find((r: any) => r["status.group"] === "PNP");
    expect(pnp).toBeDefined();
    expect(pnp!.totalSum).toBe(300);
    expect(pnp!.count).toBe(2);

    orm._close();
  });
});

describe("sub-table item flattening", () => {
  const SubItemSchema = Object({
    sku: String(),
    qty: Number(),
    nested: Object({
      color: String(),
      size: Number(),
    }),
  });

  const SubTableTestSchema = Object({
    id: Number(),
    items: Array(SubItemSchema),
  });

  function makeSubTableORM() {
    return createORM({
      path: ":memory:",
      rebuildOnLaunch: true,
      tables: {
        test: table(SubTableTestSchema, (s) => ({ primaryKey: s.id })),
      },
    });
  }

  test("sub-table items have flattened nested columns", () => {
    const orm = makeSubTableORM();
    orm.test.insert({
      id: 1,
      items: [
        { sku: "X", qty: 2, nested: { color: "red", size: 10 } },
        { sku: "Y", qty: 3, nested: { color: "blue", size: 20 } },
      ],
    });

    const results = orm.test.findMany({ include: ["items"] });
    expect(results).toHaveLength(1);
    expect(results[0]!.items).toHaveLength(2);
    expect(results[0]!.items[0]!.nested).toEqual({ color: "red", size: 10 });
    expect(results[0]!.items[1]!.nested).toEqual({ color: "blue", size: 20 });

    orm._close();
  });
});

describe("nested array-of-objects preservation", () => {
  const InvoiceSchema = Object({
    number: Number(),
    amount: Number(),
  });

  const PricingWithInvoicesSchema = Object({
    total: Number(),
    currency: String(),
    invoices: Array(InvoiceSchema),
  });

  const ArrayPreserveSchema = Object({
    id: Number(),
    pricing: PricingWithInvoicesSchema,
  });

  function makeArrayPreserveORM() {
    return createORM({
      path: ":memory:",
      rebuildOnLaunch: true,
      tables: {
        test: table(ArrayPreserveSchema, (s) => ({ primaryKey: s.id })),
      },
    });
  }

  test("nested array-of-objects inside flattened object is preserved", () => {
    const orm = makeArrayPreserveORM();
    orm.test.insert({
      id: 1,
      pricing: {
        total: 100,
        currency: "DKK",
        invoices: [
          { number: 1, amount: 50 },
          { number: 2, amount: 50 },
        ],
      },
    });

    const found = orm.test.findById(1);
    expect(found).not.toBeNull();
    expect(found!.pricing.total).toBe(100);
    expect(found!.pricing.currency).toBe("DKK");
    expect(found!.pricing.invoices).toEqual([
      { number: 1, amount: 50 },
      { number: 2, amount: 50 },
    ]);

    orm._close();
  });
});
