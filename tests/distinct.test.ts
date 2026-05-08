/**
 * foxdb/tests/distinct.test.ts
 * Tests for DISTINCT and DISTINCT ON queries.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number } from "typebox";
import { createORM, table } from "../src/index.ts";

const UserSchema = Object({
  id: String(),
  name: String(),
  age: Number(),
});

function makeORM() {
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

describe("DISTINCT queries", () => {
  let orm: ReturnType<typeof makeORM>;

  beforeEach(() => {
    orm = makeORM();
    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    orm.users.insert({ id: "u2", name: "bob", age: 25 });
    orm.users.insert({ id: "u3", name: "alice", age: 35 });
    orm.users.insert({ id: "u4", name: "charlie", age: 25 });
  });

  afterEach(() => {
    orm._close();
  });

  test("distinct returns unique rows", () => {
    const rows = orm.users.findMany({ distinct: true });
    expect(rows).toHaveLength(4);
  });

  test("distinct with select returns unique values", () => {
    const rows = orm.users.findMany({ select: ["name"], distinct: true });
    expect(rows).toHaveLength(3);
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(["alice", "bob", "charlie"]);
  });

  test("distinctOn emulates via GROUP BY", () => {
    const rows = orm.users.findMany({ distinctOn: ["name"] });
    expect(rows).toHaveLength(3);
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(["alice", "bob", "charlie"]);
  });

  test("distinctOn with where filter", () => {
    const rows = orm.users.findMany({
      where: { age: { gte: 25 } },
      distinctOn: ["age"],
    });
    expect(rows).toHaveLength(3);
    const ages = rows.map((r) => r.age).sort();
    expect(ages).toEqual([25, 30, 35]);
  });

  test("findPage with distinct returns correct total", () => {
    const page = orm.users.findPage({ select: ["name"], distinct: true });
    expect(page.total).toBe(3);
    expect(page.data).toHaveLength(3);
  });

  test("findPage with distinctOn returns correct total", () => {
    const page = orm.users.findPage({ distinctOn: ["age"] });
    expect(page.total).toBe(3);
    expect(page.data).toHaveLength(3);
  });
});
