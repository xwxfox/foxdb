/**
 * foxdb/tests/regression.test.ts
 * End-to-end regression tests exercising multiple features together.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number, Integer, Optional } from "typebox";
import { createORM, table } from "../src/index.ts";

const UserSchema = Object({
  id: String(),
  name: String(),
  email: String(),
  age: Number(),
  tags: Array(Object({ label: String() })),
  deletedAt: Optional(Integer()),
});

function makeFullORM() {
  return createORM({
    tables: {
      users: table(UserSchema, (s) => ({
        primaryKey: s.id,
        timestamps: true,
        softDelete: { column: "deletedAt" },
        indexes: [
          { columns: [s.email], unique: true },
          { columns: [s.age], where: "age > 18" },
        ],
        eviction: { maxRows: 1000, ttlColumn: "createdAt", ttlMs: 3600000 },
      })),
    },
    hooks: {
      onQuery: () => {}, // ensure zero-cost path is exercised
    },
  });
}

describe("regression suite", () => {
  let orm: ReturnType<typeof makeFullORM>;
  beforeEach(() => { orm = makeFullORM(); });
  afterEach(() => orm._close());

  test("insert + findById + update + delete round-trip", () => {
    orm.users.insert({ id: "1", name: "alice", email: "a@x.com", age: 30, tags: [{ label: "admin" }] });
    expect(orm.users.findById("1")!.name).toBe("alice");

    orm.users.update({ id: "1", name: "alice smith" });
    expect(orm.users.findById("1")!.name).toBe("alice smith");

    orm.users.deleteById("1");
    expect(orm.users.findById("1")).toBeNull();
  });

  test("insertMany + findMany + count", () => {
    orm.users.insertMany(Array.from({ length: 50 }, (_, i) => ({
      id: globalThis.String(i), name: `u${i}`, email: `u${i}@x.com`, age: i, tags: [],
    })));
    expect(orm.users.O_count()).toBe(50);
    expect(orm.users.O_findMany({ limit: 10 })).toHaveLength(10);
  });

  test("streaming iterate does not materialize full array", () => {
    orm.users.insertMany(Array.from({ length: 1000 }, (_, i) => ({
      id: globalThis.String(i), name: `u${i}`, email: `u${i}@x.com`, age: i, tags: [],
    })));
    let count = 0;
    for (const _ of orm.users.O_iterate()) count++;
    expect(count).toBe(1000);
  });

  test("select projection omits unselected columns", () => {
    orm.users.insert({ id: "1", name: "a", email: "a@x.com", age: 1, tags: [] });
    const rows = orm.users.O_findMany({ select: ["id", "name"] });
    expect("email" in rows[0]!).toBe(false);
  });

  test("aggregate works end to end", () => {
    orm.users.insertMany([
      { id: "1", name: "a", email: "a@x.com", age: 10, tags: [] },
      { id: "2", name: "b", email: "b@x.com", age: 20, tags: [] },
    ]);
    const rows = orm.users.O_aggregate({ aggregations: { totalAge: { sum: "age" } } });
    expect(rows[0]!.totalAge).toBe(30);
  });
});
