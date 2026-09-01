/**
 * foxdb/tests/entity.test.ts
 * Runtime tests for entity wrapping, materialization, and serialization.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number, Integer, Array, Optional } from "typebox";
import { createORM, table } from "../src/index.ts";

const ItemSchema = Object({
  sku: String(),
  name: String(),
  price: Number(),
  stock: Integer(),
});

const LineItemSchema = Object({
  itemNumber: String(),
  quantity: Integer(),
  unitPrice: Number(),
});

const SaleSchema = Object({
  id: String(),
  status: String(),
  total: Number(),
  lineItems: Array(LineItemSchema),
});

function makeTestORM() {
  return createORM({
    tables: {
      inventory: table(ItemSchema, (s) => ({
        primaryKey: s.sku,
        indexes: [{ columns: [s.name] }],
      })),
      sales: table(SaleSchema, (s) => ({
        primaryKey: s.id,
        indexes: [{ columns: [s.status] }],
      })),
    },
    relations: (r) => [
      r.from("sales")
        .subTable("lineItems", "itemNumber")
        .to("inventory", "sku", { as: "inventory" }),
    ],
  });
}

describe("foxdb", () => {
  let orm: ReturnType<typeof makeTestORM>;

  beforeEach(() => {
    orm = makeTestORM();

    orm.inventory.insert({ sku: "A", name: "Widget", price: 9.99, stock: 10 });
    orm.inventory.insert({ sku: "B", name: "Gadget", price: 24.99, stock: 5 });
  });

  afterEach(() => {
    orm._close();
  });

  test("insert and findById", () => {
    const sale = orm.sales.insert({
      id: "S1",
      status: "paid",
      total: 9.99,
      lineItems: [{ itemNumber: "A", quantity: 1, unitPrice: 9.99 }],
    });

    const found = orm.sales.findById("S1");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("S1");
    expect(found!.lineItems).toHaveLength(1);
  });

  test("entity serialization is clean", () => {
    const sale = orm.sales.insert({
      id: "S2",
      status: "pending",
      total: 5,
      lineItems: [{ itemNumber: "B", quantity: 2, unitPrice: 2.5 }],
    });

    const found = orm.sales.findById("S2")!;
    const json = JSON.stringify(found);
    const parsed = JSON.parse(json);

    expect(parsed.id).toBe("S2");
    expect(parsed.status).toBe("pending");
    expect(parsed.lineItems).toHaveLength(1);
    expect("materialize" in parsed).toBe(false);
    expect("related" in parsed).toBe(false);
  });

  test("materialize adds related proxy", () => {
    const sale = orm.sales.insert({
      id: "S3",
      status: "paid",
      total: 9.99,
      lineItems: [{ itemNumber: "A", quantity: 1, unitPrice: 9.99 }],
    });

    const found = orm.sales.findById("S3");
    expect(found).not.toBeNull();
    const mat = found!.materialize();

    const li = mat.lineItems[0];
    if (li) {
      expect(li.inventory).not.toBeNull();
      if (li.inventory) {
        expect(li.inventory.name).toBe("Widget");
      }
    }
  });

  test("findManyMaterialized returns batch resolved records", () => {
    orm.sales.insert({
      id: "S4",
      status: "paid",
      total: 9.99,
      lineItems: [{ itemNumber: "A", quantity: 1, unitPrice: 9.99 }],
    });
    orm.sales.insert({
      id: "S5",
      status: "paid",
      total: 24.99,
      lineItems: [{ itemNumber: "B", quantity: 1, unitPrice: 24.99 }],
    });

    const all = orm.sales.findManyMaterialized();
    expect(all).toHaveLength(2);

    const first = all[0];
    if (first) {
      const mat = first.materialize();
      const li = mat.lineItems[0];
      if (li) {
        expect(li.inventory).not.toBeNull();
        if (li.inventory) {
          expect(li.inventory.name).toBe("Widget");
        }
      }
    }
  });

  test("tables without relations omit materialize", () => {
    const item = orm.inventory.findById("A")!;
    expect("materialize" in item).toBe(false);
  });

  test("update and delete", () => {
    orm.sales.insert({
      id: "S6",
      status: "paid",
      total: 10,
      lineItems: [],
    });

    const updated = orm.sales.update({ id: "S6", status: "refunded", total: 0 });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("refunded");

    const deleted = orm.sales.deleteById("S6");
    expect(deleted).toBe(true);
    expect(orm.sales.findById("S6")).toBeNull();
  });

  test("flush clears data but keeps schema", () => {
    orm.sales.insert({
      id: "S7",
      status: "paid",
      total: 10,
      lineItems: [],
    });

    orm.sales.flush();
    expect(orm.sales.findById("S7")).toBeNull();

    // Schema still exists - can insert again
    orm.sales.insert({ id: "S7", status: "paid", total: 10, lineItems: [] });
    expect(orm.sales.findById("S7")).not.toBeNull();
  });

  test("orm._flush clears all tables", () => {
    orm.sales.insert({ id: "S8", status: "paid", total: 10, lineItems: [] });
    orm.inventory.insert({ sku: "C", name: "Thing", price: 1, stock: 1 });

    orm._flush();

    expect(orm.sales.findById("S8")).toBeNull();
    expect(orm.inventory.findById("C")).toBeNull();
  });

  test("schema hash stored in meta", () => {
    expect(orm._meta.schemaHash).not.toBeNull();
    expect(orm._meta.tables).toEqual(["inventory", "sales"]);
  });
});

const TimestampSaleSchema = Object({
  id: String(),
  status: String(),
  total: Number(),
  lineItems: Array(LineItemSchema),
  // createdAt: Optional(Number()),
  // updatedAt: Optional(Number()),
});

function makeTimestampORM() {
  return createORM({
    tables: {
      sales: table(TimestampSaleSchema, (s) => ({
        primaryKey: s.id,
        timestamps: true,
      })),
    },
  });
}

describe("foxdb timestamps", () => {
  let orm: ReturnType<typeof makeTimestampORM>;

  beforeEach(() => {
    orm = makeTimestampORM();
  });

  afterEach(() => {
    orm._close();
  });

  test("timestamps auto-injected on insert", () => {
    const sale = orm.sales.insert({
      id: "T1",
      status: "paid",
      total: 10,
      lineItems: [],
    });

    expect(sale.createdAt).toBeTypeOf("number");
    expect(sale.updatedAt).toBeTypeOf("number");
  });

  test("update refreshes updatedAt", () => {
    const sale = orm.sales.insert({
      id: "T2",
      status: "paid",
      total: 10,
      lineItems: [],
    });

    const before: number = sale.updatedAt;

    // Wait a tick to ensure time advances
    const start = Date.now();
    while (Date.now() === start) { /* spin */ }

    const updated = orm.sales.update({ id: "T2", status: "refunded" });
    expect(updated).not.toBeNull();
    if (updated) {
      expect(updated.updatedAt).toBeGreaterThan(before);
    }
  });

  test("timestamps are typed as number", () => {
    const sale = orm.sales.insert({
      id: "T3",
      status: "paid",
      total: 10,
      lineItems: [],
    });

    // Compile-time type assertion
    const _createdAt: number = sale.createdAt;
    const _updatedAt: number = sale.updatedAt;
    void _createdAt;
    void _updatedAt;

    expect(typeof sale.createdAt).toBe("number");
    expect(typeof sale.updatedAt).toBe("number");
  });
});
