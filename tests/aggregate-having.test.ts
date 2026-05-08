/**
 * foxdb/tests/aggregate-having.test.ts
 * Tests for HAVING clause on aggregates.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number } from "typebox";
import { createORM, table } from "../src/index.ts";

const OrderSchema = Object({
  id: String(),
  status: String(),
  amount: Number(),
});

function makeORM() {
  return createORM({
    path: ":memory:",
    rebuildOnLaunch: true,
    tables: {
      orders: table(OrderSchema, (s) => ({
        primaryKey: s.id,
      })),
    },
  });
}

describe("aggregate with HAVING", () => {
  let orm: ReturnType<typeof makeORM>;

  beforeEach(() => {
    orm = makeORM();
    orm.orders.insert({ id: "o1", status: "pending", amount: 100 });
    orm.orders.insert({ id: "o2", status: "pending", amount: 200 });
    orm.orders.insert({ id: "o3", status: "completed", amount: 300 });
    orm.orders.insert({ id: "o4", status: "completed", amount: 400 });
  });

  afterEach(() => {
    orm._close();
  });

  test("filters aggregated groups with having", () => {
    const rows = orm.orders.aggregate({
      groupBy: ["status"],
      aggregations: { total: { sum: "amount" } },
      having: { total: { gt: 200 } },
    });
    expect(rows).toHaveLength(2);
    const byStatus = globalThis.Object.fromEntries(rows.map((r) => [r.status, r]));
    expect(byStatus.pending.total).toBe(300);
    expect(byStatus.completed.total).toBe(700);
  });

  test("having excludes groups below threshold", () => {
    const rows = orm.orders.aggregate({
      groupBy: ["status"],
      aggregations: { total: { sum: "amount" } },
      having: { total: { gt: 500 } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("completed");
  });

  test("having with count aggregation", () => {
    const rows = orm.orders.aggregate({
      groupBy: ["status"],
      aggregations: { cnt: { count: "*" } },
      having: { cnt: { gte: 2 } },
    });
    expect(rows).toHaveLength(2);
  });

  test("having combined with where", () => {
    const rows = orm.orders.aggregate({
      where: { amount: { gte: 200 } },
      groupBy: ["status"],
      aggregations: { total: { sum: "amount" } },
      having: { total: { gt: 200 } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("completed");
  });
});
