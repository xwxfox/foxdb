/**
 * foxdb/tests/iterate.test.ts
 * Tests for the generator-based iterate() streaming API.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number } from "typebox";
import { createORM, table } from "../src/index.ts";

const UserSchema = Object({
  id: String(),
  name: String(),
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

describe("repository.iterate", () => {
  let orm: ReturnType<typeof makeTestORM>;

  beforeEach(() => {
    orm = makeTestORM();
    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    orm.users.insert({ id: "u2", name: "bob", age: 25 });
    orm.users.insert({ id: "u3", name: "charlie", age: 35 });
    orm.users.insert({ id: "u4", name: "diana", age: 28 });
  });

  afterEach(() => {
    orm._close();
  });

  test("yields all rows without options", () => {
    const names: string[] = [];
    for (const user of orm.users.O_iterate()) {
      names.push(user.name);
    }
    expect(names).toHaveLength(4);
    expect(names).toContain("alice");
    expect(names).toContain("bob");
    expect(names).toContain("charlie");
    expect(names).toContain("diana");
  });

  test("respects where clause", () => {
    const names: string[] = [];
    for (const user of orm.users.O_iterate({ where: { age: { gte: 30 } } })) {
      names.push(user.name);
    }
    expect(names).toHaveLength(2);
    expect(names).toContain("alice");
    expect(names).toContain("charlie");
  });

  test("respects limit", () => {
    const names: string[] = [];
    for (const user of orm.users.O_iterate({ limit: 2 })) {
      names.push(user.name);
    }
    expect(names).toHaveLength(2);
  });

  test("respects orderBy", () => {
    const names: string[] = [];
    for (const user of orm.users.O_iterate({ orderBy: { column: "age", direction: "DESC" } })) {
      names.push(user.name);
    }
    expect(names[0]).toBe("charlie");
    expect(names[names.length - 1]).toBe("bob");
  });

  test("works with select projection", () => {
    const rows: Array<Record<string, unknown>> = [];
    for (const user of orm.users.O_iterate({ select: ["id", "name"] })) {
      rows.push(user as Record<string, unknown>);
    }
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect("id" in row).toBe(true);
      expect("name" in row).toBe(true);
      expect("age" in row).toBe(false);
    }
  });
});
