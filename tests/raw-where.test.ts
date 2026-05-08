/**
 * foxdb/tests/raw-where.test.ts
 * Tests for _raw SQL escape hatch in WHERE clauses.
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

describe("_raw SQL escape hatch", () => {
  let orm: ReturnType<typeof makeORM>;

  beforeEach(() => {
    orm = makeORM();
    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    orm.users.insert({ id: "u2", name: "bob", age: 25 });
  });

  afterEach(() => {
    orm._close();
  });

  test("_raw filters via raw SQL", () => {
    const rows = orm.users.findMany({
      where: {
        _raw: { sql: "age > ?", params: [20] },
      },
    });
    expect(rows).toHaveLength(2);
  });

  test("_raw combined with typed filters", () => {
    const rows = orm.users.findMany({
      where: {
        name: { eq: "alice" },
        _raw: { sql: "age >= ?", params: [30] },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("u1");
  });
});
