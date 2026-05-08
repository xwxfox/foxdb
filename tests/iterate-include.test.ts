/**
 * foxdb/tests/iterate-include.test.ts
 * Tests for generator-based iterate() with sub-table hydration.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number, Array as TypeBoxArray } from "typebox";
import { createORM, table } from "../src/index.ts";

const OrderSchema = Object({
  id: String(),
  total: Number(),
  items: TypeBoxArray(Object({ name: String(), qty: Number() })),
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

describe("repository.iterate with include", () => {
  let orm: ReturnType<typeof makeORM>;

  beforeEach(() => {
    orm = makeORM();
    for (let i = 0; i < 250; i++) {
      orm.orders.insert({
        id: `o${i}`,
        total: i * 10,
        items: [
          { name: `item-a-${i}`, qty: 1 },
          { name: `item-b-${i}`, qty: 2 },
        ],
      });
    }
  });

  afterEach(() => {
    orm._close();
  });

  test("yields rows with sub-tables hydrated", () => {
    let count = 0;
    for (const order of orm.orders.iterate({ include: ["items"] })) {
      expect(order.items).toHaveLength(2);
      expect(order.items[0]!.name).toBe(`item-a-${count}`);
      count++;
    }
    expect(count).toBe(250);
  });

  test("respects where clause with include", () => {
    let count = 0;
    for (const order of orm.orders.iterate({ where: { total: { gte: 1000 } }, include: ["items"] })) {
      expect(order.total).toBeGreaterThanOrEqual(1000);
      expect(order.items).toHaveLength(2);
      count++;
    }
    expect(count).toBe(150);
  });

  test("respects limit with include", () => {
    let count = 0;
    for (const order of orm.orders.iterate({ include: ["items"], limit: 50 })) {
      count++;
    }
    expect(count).toBe(50);
  });

  test("works with select and include", () => {
    let count = 0;
    for (const order of orm.orders.iterate({ select: ["id", "total"], include: ["items"] })) {
      expect("id" in order).toBe(true);
      expect("total" in order).toBe(true);
      expect("items" in order).toBe(true);
      expect((order as Record<string, unknown>).items).toHaveLength(2);
      count++;
    }
    expect(count).toBe(250);
  });
});
