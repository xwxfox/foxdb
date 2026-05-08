/**
 * foxdb/tests/window.test.ts
 * Tests for window function queries.
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

describe("repository.windowQuery", () => {
  let orm: ReturnType<typeof makeORM>;

  beforeEach(() => {
    orm = makeORM();
    orm.orders.insert({ id: "o1", status: "pending", amount: 100 });
    orm.orders.insert({ id: "o2", status: "pending", amount: 200 });
    orm.orders.insert({ id: "o3", status: "pending", amount: 200 });
    orm.orders.insert({ id: "o4", status: "completed", amount: 300 });
    orm.orders.insert({ id: "o5", status: "completed", amount: 400 });
  });

  afterEach(() => {
    orm._close();
  });

  test("rowNumber", () => {
    const rows = orm.orders.windowQuery({
      orderBy: [{ column: "amount", direction: "ASC" }],
      select: { rn: { rowNumber: true } },
    });
    expect(rows).toHaveLength(5);
    expect(rows[0]!.rn).toBe(1);
    expect(rows[4]!.rn).toBe(5);
  });

  test("rank with ties", () => {
    const rows = orm.orders.windowQuery({
      orderBy: [{ column: "amount", direction: "ASC" }],
      select: { rnk: { rank: true } },
    });
    expect(rows).toHaveLength(5);
    expect(rows[0]!.rnk).toBe(1);
    expect(rows[1]!.rnk).toBe(2);
    expect(rows[2]!.rnk).toBe(2); // tie
    expect(rows[3]!.rnk).toBe(4);
  });

  test("denseRank", () => {
    const rows = orm.orders.windowQuery({
      orderBy: [{ column: "amount", direction: "ASC" }],
      select: { drnk: { denseRank: true } },
    });
    expect(rows).toHaveLength(5);
    expect(rows[0]!.drnk).toBe(1);
    expect(rows[1]!.drnk).toBe(2);
    expect(rows[2]!.drnk).toBe(2); // tie
    expect(rows[3]!.drnk).toBe(3); // no gap
  });

  test("lead", () => {
    const rows = orm.orders.windowQuery({
      orderBy: [{ column: "amount", direction: "ASC" }],
      select: { nextAmount: { lead: "amount", offset: 1 } },
    });
    expect(rows).toHaveLength(5);
    expect(rows[0]!.nextAmount).toBe(200);
    expect(rows[4]!.nextAmount).toBeNull();
  });

  test("lag", () => {
    const rows = orm.orders.windowQuery({
      orderBy: [{ column: "amount", direction: "ASC" }],
      select: { prevAmount: { lag: "amount", offset: 1 } },
    });
    expect(rows).toHaveLength(5);
    expect(rows[0]!.prevAmount).toBeNull();
    expect(rows[1]!.prevAmount).toBe(100);
  });

  test("partitionBy", () => {
    const rows = orm.orders.windowQuery({
      partitionBy: ["status"],
      orderBy: [{ column: "amount", direction: "ASC" }],
      select: { rn: { rowNumber: true } },
    });
    expect(rows).toHaveLength(5);
    // With 2 partitions, there should be two rows with rn=1
    const rankOnes = rows.filter((r) => r.rn === 1);
    expect(rankOnes).toHaveLength(2);
  });

  test("with where filter", () => {
    const rows = orm.orders.windowQuery({
      where: { status: { eq: "pending" } },
      orderBy: [{ column: "amount", direction: "ASC" }],
      select: { rn: { rowNumber: true } },
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]!.rn).toBe(1);
  });

  test("with limit", () => {
    const rows = orm.orders.windowQuery({
      orderBy: [{ column: "amount", direction: "ASC" }],
      select: { rn: { rowNumber: true } },
      limit: 2,
    });
    expect(rows).toHaveLength(2);
  });
});
