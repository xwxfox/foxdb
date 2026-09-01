/**
 * foxdb/tests/insert-many.test.ts
 * Tests for multi-value INSERT in insertMany.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number, Array as TypeBoxArray } from "typebox";
import { createORM, table } from "../src/index.ts";

const UserSchema = Object({
  id: String(),
  name: String(),
  age: Number(),
});

const OrderSchema = Object({
  id: String(),
  total: Number(),
  items: TypeBoxArray(Object({ name: String(), qty: Number() })),
});

function makeUserORM() {
  return createORM({
    tables: {
      users: table(UserSchema, (s) => ({
        primaryKey: s.id,
      })),
    },
  });
}

function makeOrderORM() {
  return createORM({
    tables: {
      orders: table(OrderSchema, (s) => ({
        primaryKey: s.id,
      })),
    },
  });
}

describe("repository.insertMany multi-value", () => {
  let orm: ReturnType<typeof makeUserORM>;

  beforeEach(() => {
    orm = makeUserORM();
  });

  afterEach(() => {
    orm._close();
  });

  test("inserts 500 rows correctly", () => {
    const records = Array.from({ length: 500 }, (_, i) => ({
      id: `u${i}`,
      name: `user-${i}`,
      age: i % 100,
    }));

    const inserted = orm.users.insertMany(records);
    expect(inserted).toHaveLength(500);

    const count = orm.users.O_count();
    expect(count).toBe(500);

    const found = orm.users.findById("u499");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("user-499");
  });

  test("inserts 50k rows fast", () => {
    const records = Array.from({ length: 50000 }, (_, i) => ({
      id: `u${i}`,
      name: `user-${i}`,
      age: i % 100,
    }));

    const start = performance.now();
    const inserted = orm.users.insertMany(records);
    const elapsed = performance.now() - start;

    expect(inserted).toHaveLength(50000);
    expect(orm.users.O_count()).toBe(50000);
    // Should complete in under 5 seconds with multi-value insert
    expect(elapsed).toBeLessThan(5000);
  });

  test("inserts with sub-tables correctly", () => {
    const orderOrm = makeOrderORM();
    try {
      const records = Array.from({ length: 100 }, (_, i) => ({
        id: `o${i}`,
        total: i * 10,
        items: [
          { name: "item-a", qty: 1 },
          { name: "item-b", qty: 2 },
        ],
      }));

      const inserted = orderOrm.orders.insertMany(records);
      expect(inserted).toHaveLength(100);

      const found = orderOrm.orders.findById("o99");
      expect(found).not.toBeNull();
      expect(found!.items).toHaveLength(2);
      const firstItem = found!.items[0]!;
      const secondItem = found!.items[1]!;
      expect(firstItem.name).toBe("item-a");
      expect(secondItem.qty).toBe(2);
    } finally {
      orderOrm._close();
    }
  });
});
