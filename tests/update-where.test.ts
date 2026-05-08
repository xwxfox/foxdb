/**
 * foxdb/tests/update-where.test.ts
 * Tests for bulk conditional update (updateWhere).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number, Boolean, Optional } from "typebox";
import { createORM, table } from "../src/index.ts";

const UserSchema = Object({
  id: String(),
  name: String(),
  age: Number(),
  status: Object({
    group: String(),
    active: Optional(Boolean()),
  }),
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

describe("repository.updateWhere", () => {
  let orm: ReturnType<typeof makeORM>;

  beforeEach(() => {
    orm = makeORM();
    orm.users.insert({ id: "u1", name: "alice", age: 30, status: { group: "admin", active: true } });
    orm.users.insert({ id: "u2", name: "bob", age: 25, status: { group: "user", active: true } });
    orm.users.insert({ id: "u3", name: "charlie", age: 35, status: { group: "user", active: false } });
    orm.users.insert({ id: "u4", name: "diana", age: 28, status: { group: "admin", active: true } });
  });

  afterEach(() => {
    orm._close();
  });

  test("updates rows matching where clause", () => {
    const changed = orm.users.updateWhere({
      where: { "status.group": { eq: "user" } },
      data: { age: 99 },
    });
    expect(changed).toBe(2);

    const found = orm.users.findMany({ where: { age: { eq: 99 } } });
    expect(found).toHaveLength(2);
    expect(found.map((u) => u.id).sort()).toEqual(["u2", "u3"]);
  });

  test("updates nested flattened columns", () => {
    const changed = orm.users.updateWhere({
      where: { "status.group": { eq: "admin" } },
      data: { status: { group: "superadmin" } },
    });
    expect(changed).toBe(2);

    const admins = orm.users.findMany({ where: { "status.group": { eq: "superadmin" } } });
    expect(admins).toHaveLength(2);
    expect(admins.map((u) => u.id).sort()).toEqual(["u1", "u4"]);
  });

  test("does not update rows that do not match", () => {
    const changed = orm.users.updateWhere({
      where: { name: { eq: "nobody" } },
      data: { age: 99 },
    });
    expect(changed).toBe(0);
  });

  test("emits updateWhere event with count", () => {
    let captured: unknown;
    orm._events.on("users", "updateWhere", (payload) => {
      captured = payload;
    });
    orm.users.updateWhere({
      where: { age: { gte: 30 } },
      data: { name: "senior" },
    });
    expect(captured).toBeDefined();
    const p = captured as Record<string, unknown>;
    expect(p.table).toBe("users");
    expect(p.operation).toBe("updateWhere");
    expect(p.result).toBe(2);
  });

  test("does not touch missing nested fields", () => {
    orm.users.updateWhere({
      where: { id: { eq: "u1" } },
      data: { status: { group: "superadmin" } },
    });
    const found = orm.users.findById("u1");
    expect(found).not.toBeNull();
    expect(found!.status.group).toBe("superadmin");
    expect(found!.status.active).toBe(true);
  });
});

describe("repository.updateWhere with soft delete", () => {
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

  test("skips soft-deleted rows by default", () => {
    const orm = makeSoftORM();
    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    orm.users.insert({ id: "u2", name: "bob", age: 25 });
    orm.users.deleteById("u2");

    const changed = orm.users.updateWhere({
      where: { age: { gte: 20 } },
      data: { name: "updated" },
    });
    expect(changed).toBe(1);

    const found = orm.users.findById("u1");
    expect(found!.name).toBe("updated");
    orm._close();
  });

  test("includeDeleted updates soft-deleted rows", () => {
    const orm = makeSoftORM();
    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    orm.users.insert({ id: "u2", name: "bob", age: 25 });
    orm.users.deleteById("u2");

    const changed = orm.users.updateWhere({
      where: { age: { gte: 20 } },
      data: { name: "updated" },
      includeDeleted: true,
    });
    expect(changed).toBe(2);
    orm._close();
  });
});
