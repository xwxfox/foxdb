/**
 * foxdb/tests/generated-columns.test.ts
 * Tests for GENERATED ALWAYS AS (expr) STORED columns.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number } from "typebox";
import { createORM, table } from "../src/index.ts";

const OrderSchema = Object({
  id: String(),
  amount: Number(),
});

function makeORM() {
  return createORM({
    path: ":memory:",
    rebuildOnLaunch: true,
    tables: {
      orders: table(OrderSchema, (s) => ({
        primaryKey: s.id,
        generated: [
          { name: "doubleAmount", expr: "amount * 2", sqlType: "REAL" },
        ],
        indexes: [{ columns: [{ name: "doubleAmount" }] }],
      })),
    },
  });
}

describe("generated columns", () => {
  let orm: ReturnType<typeof makeORM>;

  beforeEach(() => {
    orm = makeORM();
  });

  afterEach(() => {
    orm._close();
  });

  test("generated column is computed from expression", () => {
    orm.orders.insert({ id: "o1", amount: 100 });
    const row = orm.orders.findById("o1");
    expect(row).not.toBeNull();
    expect((row as Record<string, unknown>).doubleAmount).toBe(200);
  });

  test("generated column is queryable via where", () => {
    orm.orders.insert({ id: "o1", amount: 100 });
    orm.orders.insert({ id: "o2", amount: 200 });
    const rows = orm.orders.findMany({
      where: { doubleAmount: { gte: 300 } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("o2");
  });

  test("generated column is ignored on insert", () => {
    orm.orders.insert({ id: "o1", amount: 100 });
    const meta = orm.orders.meta;
    const doubleCol = meta.columns.find((c) => c.name === "doubleAmount");
    expect(doubleCol).toBeDefined();
    expect(doubleCol!.generated).toBe(true);
  });

  test("generated column is ignored on update", () => {
    orm.orders.insert({ id: "o1", amount: 100 });
    orm.orders.update({ id: "o1", amount: 150 });
    const row = orm.orders.findById("o1");
    expect((row as Record<string, unknown>).doubleAmount).toBe(300);
  });

  test("generated column is ignored on updateWhere", () => {
    orm.orders.insert({ id: "o1", amount: 100 });
    orm.orders.updateWhere({
      where: { id: { eq: "o1" } },
      data: { amount: 150 },
    });
    const row = orm.orders.findById("o1");
    expect((row as Record<string, unknown>).doubleAmount).toBe(300);
  });
});
