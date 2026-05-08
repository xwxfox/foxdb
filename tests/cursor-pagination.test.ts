/**
 * foxdb/tests/cursor-pagination.test.ts
 * Tests for cursor-based pagination (seek method).
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
      })),
    },
  });
}

describe("repository.findCursorPage", () => {
  let orm: ReturnType<typeof makeORM>;

  beforeEach(() => {
    orm = makeORM();
    orm.orders.insert({ id: "o1", amount: 10 });
    orm.orders.insert({ id: "o2", amount: 20 });
    orm.orders.insert({ id: "o3", amount: 30 });
    orm.orders.insert({ id: "o4", amount: 40 });
    orm.orders.insert({ id: "o5", amount: 50 });
  });

  afterEach(() => {
    orm._close();
  });

  test("returns first page with nextCursor", () => {
    const page = orm.orders.findCursorPage({
      orderBy: { column: "amount", direction: "ASC" },
      limit: 2,
    });
    expect(page.data).toHaveLength(2);
    expect(page.data[0]!.amount).toBe(10);
    expect(page.nextCursor).not.toBeNull();
    expect(page.prevCursor).not.toBeNull();
  });

  test("navigates forward with next cursor", () => {
    const p1 = orm.orders.findCursorPage({
      orderBy: { column: "amount", direction: "ASC" },
      limit: 2,
    });
    const p2 = orm.orders.findCursorPage({
      orderBy: { column: "amount", direction: "ASC" },
      cursor: { ...p1.nextCursor!, direction: "next" },
      limit: 2,
    });
    expect(p2.data).toHaveLength(2);
    expect(p2.data[0]!.amount).toBe(30);
  });

  test("navigates backward with prev cursor", () => {
    const p1 = orm.orders.findCursorPage({
      orderBy: { column: "amount", direction: "ASC" },
      limit: 2,
    });
    const p2 = orm.orders.findCursorPage({
      orderBy: { column: "amount", direction: "ASC" },
      cursor: { ...p1.nextCursor!, direction: "next" },
      limit: 2,
    });
    const p3 = orm.orders.findCursorPage({
      orderBy: { column: "amount", direction: "ASC" },
      cursor: { ...p2.prevCursor!, direction: "prev" },
      limit: 2,
    });
    expect(p3.data[0]!.amount).toBe(10);
    expect(p3.data[1]!.amount).toBe(20);
  });

  test("works with DESC order", () => {
    const page = orm.orders.findCursorPage({
      orderBy: { column: "amount", direction: "DESC" },
      limit: 2,
    });
    expect(page.data[0]!.amount).toBe(50);
    expect(page.data[1]!.amount).toBe(40);
  });

  test("respects where clause", () => {
    const page = orm.orders.findCursorPage({
      where: { amount: { gte: 30 } },
      orderBy: { column: "amount", direction: "ASC" },
      limit: 2,
    });
    expect(page.data).toHaveLength(2);
    expect(page.data[0]!.amount).toBe(30);
  });
});
