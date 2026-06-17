import { describe, test, expect, beforeEach } from "bun:test";
import { Type } from "typebox";
import { createORM, table } from "../src/index.ts";

function makeORM() {
  const LineItemSchema = Type.Object({
    sku: Type.String(),
    quantity: Type.Number(),
    unitPrice: Type.Number(),
  });

  const OrderSchema = Type.Object({
    id: Type.String(),
    customer: Type.String(),
    total: Type.Number(),
    items: Type.Array(LineItemSchema),
  });

  const orm = createORM({
    path: ":memory:",
    tables: {
      orders: table(OrderSchema, (s) => ({
        primaryKey: s.id,
      })),
    },
    rebuildOnLaunch: true,
  });

  (orm as any).orders.insert({
    id: "o1", customer: "alice", total: 50,
    items: [
      { sku: "A", quantity: 2, unitPrice: 10 },
      { sku: "B", quantity: 1, unitPrice: 30 },
    ],
  });
  (orm as any).orders.insert({
    id: "o2", customer: "bob", total: 200,
    items: [
      { sku: "A", quantity: 5, unitPrice: 10 },
      { sku: "C", quantity: 10, unitPrice: 15 },
    ],
  });
  (orm as any).orders.insert({
    id: "o3", customer: "carol", total: 25,
    items: [
      { sku: "D", quantity: 1, unitPrice: 25 },
    ],
  });

  return orm;
}

describe("nested() filter on object-array sub-tables", () => {
  test("nested() with single equality filter", () => {
    const orders = (makeORM() as any).orders;
    const results = orders
      .findMany()
      .nested("items", (q: any) => q.equals("sku", "C"))
      .exec();
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("o2");
  });

  test("nested() with multiple chained filters (AND)", () => {
    const orders = (makeORM() as any).orders;
    const results = orders
      .findMany()
      .nested("items", (q: any) => q.equals("sku", "A").greaterThan("quantity", 3))
      .exec();
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("o2");
  });

  test("nested() combined with top-level filter", () => {
    const orders = (makeORM() as any).orders;
    const results = orders
      .findMany()
      .greaterThan("total", 30)
      .nested("items", (q: any) => q.equals("sku", "B"))
      .exec();
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("o1");
  });

  test("nested() with or() inside callback", () => {
    const orders = (makeORM() as any).orders;
    const results = orders
      .findMany()
      .nested("items", (q: any) => q.or((q2: any) => q2.equals("sku", "C").equals("sku", "D")))
      .exec();
    expect(results).toHaveLength(2);
    const ids = results.map((r: any) => r.id).sort();
    expect(ids).toEqual(["o2", "o3"]);
  });

  test("not() wrapping nested()", () => {
    const orders = (makeORM() as any).orders;
    const results = orders
      .findMany()
      .not((q: any) => q.nested("items", (q2: any) => q2.equals("sku", "A")))
      .exec();
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("o3");
  });

  test("nested() with count() on parent filtered by sub-table", () => {
    const orders = (makeORM() as any).orders;
    const count = orders
      .count()
      .nested("items", (q: any) => q.greaterThan("quantity", 5))
      .exec();
    expect(count).toBe(1);
  });

  test("nested() on chain findOne", () => {
    const orders = (makeORM() as any).orders;
    const order = orders
      .findOne()
      .nested("items", (q: any) => q.equals("sku", "C"))
      .exec();
    expect(order).not.toBeNull();
    expect(order.id).toBe("o2");
  });
});
