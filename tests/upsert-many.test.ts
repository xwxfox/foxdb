/**
 * foxdb/tests/upsert-many.test.ts
 * Tests for bulk upsert (upsertMany).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number, Array as TypeBoxArray, Optional } from "typebox";
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
    path: ":memory:",
    rebuildOnLaunch: true,
    tables: {
      users: table(UserSchema, (s) => ({
        primaryKey: s.id,
      })),
    },
  });
}

function makeOrderORM() {
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

describe("repository.upsertMany", () => {
  let orm: ReturnType<typeof makeUserORM>;

  beforeEach(() => {
    orm = makeUserORM();
  });

  afterEach(() => {
    orm._close();
  });

  test("inserts new rows", () => {
    const changed = orm.users.upsertMany({
      data: [
        { id: "u1", name: "alice", age: 30 },
        { id: "u2", name: "bob", age: 25 },
      ],
      conflictTarget: "id",
    });
    expect(changed).toBe(2);
    expect(orm.users.count()).toBe(2);
    expect(orm.users.findById("u1")!.name).toBe("alice");
  });

  test("updates existing rows on conflict", () => {
    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    const changed = orm.users.upsertMany({
      data: [
        { id: "u1", name: "alice smith", age: 31 },
        { id: "u2", name: "bob", age: 25 },
      ],
      conflictTarget: "id",
    });
    expect(changed).toBe(2);
    expect(orm.users.findById("u1")!.name).toBe("alice smith");
    expect(orm.users.findById("u1")!.age).toBe(31);
  });

  test("respects update columns option", () => {
    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    const changed = orm.users.upsertMany({
      data: [
        { id: "u1", name: "alice smith", age: 31 },
      ],
      conflictTarget: "id",
      update: ["age"],
    });
    expect(changed).toBe(1);
    expect(orm.users.findById("u1")!.name).toBe("alice");
    expect(orm.users.findById("u1")!.age).toBe(31);
  });

  test("handles large batches", () => {
    const records = Array.from({ length: 5000 }, (_, i) => ({
      id: `u${i}`,
      name: `user-${i}`,
      age: i % 100,
    }));
    const changed = orm.users.upsertMany({
      data: records,
      conflictTarget: "id",
    });
    expect(changed).toBe(5000);
    expect(orm.users.count()).toBe(5000);
  });

  test("reconciles sub-tables", () => {
    const orderOrm = makeOrderORM();
    try {
      orderOrm.orders.insert({
        id: "o1",
        total: 100,
        items: [{ name: "a", qty: 1 }],
      });
      orderOrm.orders.upsertMany({
        data: [
          {
            id: "o1",
            total: 200,
            items: [{ name: "b", qty: 2 }, { name: "c", qty: 3 }],
          },
        ],
        conflictTarget: "id",
      });
      const found = orderOrm.orders.findById("o1");
      expect(found!.total).toBe(200);
      expect(found!.items).toHaveLength(2);
      expect(found!.items[0]!.name).toBe("b");
      expect(found!.items[1]!.qty).toBe(3);
    } finally {
      orderOrm._close();
    }
  });

  test("emits upsertMany event", () => {
    let captured: unknown;
    orm._events.on("users", "upsertMany", (payload) => {
      captured = payload;
    });
    orm.users.upsertMany({
      data: [{ id: "u1", name: "alice", age: 30 }],
      conflictTarget: "id",
    });
    expect(captured).toBeDefined();
    const p = captured as Record<string, unknown>;
    expect(p.table).toBe("users");
    expect(p.operation).toBe("upsertMany");
  });
});

describe("repository.upsertMany with soft delete", () => {
  const SoftUserSchema = Object({
    id: String(),
    name: String(),
    age: Number(),
    deletedAt: Optional(Number()),
  });

  function makeSoftORM() {
    return createORM({
      path: ":memory:",
      rebuildOnLaunch: true,
      tables: {
        users: table(SoftUserSchema, (s) => ({
          primaryKey: s.id,
          softDelete: { column: "deletedAt" },
        })),
      },
    });
  }

  test("reactivates soft-deleted rows on conflict", () => {
    const orm = makeSoftORM();
    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    orm.users.deleteById("u1");
    expect(orm.users.findById("u1")).toBeNull();

    orm.users.upsertMany({
      data: [{ id: "u1", name: "alice", age: 31 }],
      conflictTarget: "id",
    });
    const found = orm.users.findById("u1");
    expect(found).not.toBeNull();
    expect(found!.age).toBe(31);
    orm._close();
  });
});
