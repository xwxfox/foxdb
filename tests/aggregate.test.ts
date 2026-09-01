/**
 * foxdb/tests/aggregate.test.ts
 * Tests for aggregation helpers.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object as TObject, String, Number } from "typebox";
import { createORM, table } from "../src/index.ts";

const OrderSchema = TObject({
  id: String(),
  status: String(),
  amount: Number(),
});

function makeTestORM() {
  return createORM({
    tables: {
      orders: table(OrderSchema, (s) => ({
        primaryKey: s.id,
      })),
    },
  });
}

describe("repository.aggregate", () => {
  let orm: ReturnType<typeof makeTestORM>;

  beforeEach(() => {
    orm = makeTestORM();
    orm.orders.insert({ id: "o1", status: "pending", amount: 100 });
    orm.orders.insert({ id: "o2", status: "pending", amount: 200 });
    orm.orders.insert({ id: "o3", status: "completed", amount: 300 });
    orm.orders.insert({ id: "o4", status: "completed", amount: 400 });
  });

  afterEach(() => {
    orm._close();
  });

  test("sum aggregation", () => {
    const rows = orm.orders.O_aggregate({
      aggregations: { total: { sum: "amount" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total).toBe(1000);
  });

  test("count aggregation with *", () => {
    const rows = orm.orders.O_aggregate({
      aggregations: { total: { count: "*" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total).toBe(4);
  });

  test("count aggregation with column", () => {
    const rows = orm.orders.O_aggregate({
      aggregations: { total: { count: "status" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total).toBe(4);
  });

  test("avg aggregation", () => {
    const rows = orm.orders.O_aggregate({
      aggregations: { mean: { avg: "amount" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mean).toBe(250);
  });

  test("min and max aggregation", () => {
    const rows = orm.orders.O_aggregate({
      aggregations: { minAmount: { min: "amount" }, maxAmount: { max: "amount" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.minAmount).toBe(100);
    expect(rows[0]!.maxAmount).toBe(400);
  });

  test("groupBy with aggregation", () => {
    const rows = orm.orders.O_aggregate({
      groupBy: ["status"],
      aggregations: { total: { sum: "amount" }, count: { count: "*" } },
    });
    expect(rows).toHaveLength(2);
    const byStatus = globalThis.Object.fromEntries(rows.map((r) => [r.status, r]));
    expect(byStatus.pending?.total).toBe(300);
    expect(byStatus.pending?.count).toBe(2);
    expect(byStatus.completed?.total).toBe(700);
    expect(byStatus.completed?.count).toBe(2);
  });

  test("where filter with aggregation", () => {
    const rows = orm.orders.O_aggregate({
      where: { status: { eq: "completed" } },
      aggregations: { total: { sum: "amount" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total).toBe(700);
  });

  test("event emission on aggregate", () => {
    let captured: unknown;
    orm._events.on("orders", "aggregate", (payload) => {
      captured = payload;
    });
    orm.orders.O_aggregate({
      aggregations: { total: { sum: "amount" } },
    });
    expect(captured).toBeDefined();
    const p = captured as Record<string, unknown>;
    expect(p.table).toBe("orders");
    expect(p.operation).toBe("aggregate");
  });
});
