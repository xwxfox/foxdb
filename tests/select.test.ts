/**
 * foxdb/tests/select.test.ts
 * Tests for column projection via findMany/select.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number } from "typebox";
import { createORM, table } from "../src/index.ts";

const UserSchema = Object({
  id: String(),
  name: String(),
  email: String(),
  age: Number(),
});

function makeTestORM() {
  return createORM({
    tables: {
      users: table(UserSchema, (s) => ({
        primaryKey: s.id,
      })),
    },
  });
}

describe("repository.select projection", () => {
  let orm: ReturnType<typeof makeTestORM>;

  beforeEach(() => {
    orm = makeTestORM();
    orm.users.insert({ id: "u1", name: "alice", email: "a@x.com", age: 30 });
    orm.users.insert({ id: "u2", name: "bob", email: "b@x.com", age: 25 });
  });

  afterEach(() => {
    orm._close();
  });

  test("findMany with select returns only chosen columns", () => {
    const rows = orm.users.O_findMany({ select: ["id", "name"] });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      expect("id" in r).toBe(true);
      expect("name" in r).toBe(true);
      expect("email" in r).toBe(false);
      expect("age" in r).toBe(false);
    }
  });

  test("findOne with select returns only chosen columns", () => {
    const row = orm.users.O_findOne({ where: { id: { eq: "u1" } }, select: ["name", "age"] });
    expect(row).not.toBeNull();
    const r = row as Record<string, unknown>;
    expect("name" in r).toBe(true);
    expect("age" in r).toBe(true);
    expect("id" in r).toBe(false);
    expect("email" in r).toBe(false);
  });

  test("findPage with select returns only chosen columns", () => {
    const page = orm.users.O_findPage({ select: ["email"], limit: 1 });
    expect(page.data).toHaveLength(1);
    const r = page.data[0] as Record<string, unknown>;
    expect("email" in r).toBe(true);
    expect("id" in r).toBe(false);
    expect("name" in r).toBe(false);
    expect("age" in r).toBe(false);
  });

  test("select without projection returns all columns", () => {
    const rows = orm.users.O_findMany();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      expect("id" in r).toBe(true);
      expect("name" in r).toBe(true);
      expect("email" in r).toBe(true);
      expect("age" in r).toBe(true);
    }
  });
});
