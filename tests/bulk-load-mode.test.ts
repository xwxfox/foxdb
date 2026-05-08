/**
 * foxdb/tests/bulk-load-mode.test.ts
 * Tests for bulk-load performance mode.
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
    bulkLoadMode: true,
    tables: {
      users: table(UserSchema, (s) => ({
        primaryKey: s.id,
      })),
    },
  });
}

describe("bulk-load mode", () => {
  let orm: ReturnType<typeof makeORM>;

  beforeEach(() => {
    orm = makeORM();
  });

  afterEach(() => {
    orm._close();
  });

  test("creates ORM with bulkLoadMode enabled", () => {
    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    expect(orm.users.findById("u1")!.name).toBe("alice");
  });

  test("runtime toggle disables and re-enables fsync", () => {
    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    orm._setBulkLoadMode(false);
    orm.users.insert({ id: "u2", name: "bob", age: 25 });
    orm._setBulkLoadMode(true);
    orm.users.insert({ id: "u3", name: "charlie", age: 35 });
    expect(orm.users.count()).toBe(3);
  });
});
