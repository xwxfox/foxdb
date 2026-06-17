import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Integer, Optional } from "typebox";
import { createORM, table } from "../src/index.ts";

const Schema = Object({ id: String(), name: String(), deletedAt: Optional(Integer()) });

function makeORM() {
  return createORM({
    tables: {
      users: table(Schema, (s) => ({ primaryKey: s.id, softDelete: { column: "deletedAt" } })),
    },
  });
}

describe("soft deletes", () => {
  let orm: ReturnType<typeof makeORM>;
  beforeEach(() => { orm = makeORM(); orm.users.insert({ id: "1", name: "a" }); });
  afterEach(() => orm._close());

  test("findMany hides deleted rows", () => {
    orm.users.deleteById("1");
    expect(orm.users.O_findMany()).toHaveLength(0);
  });

  test("includeDeleted shows all rows", () => {
    orm.users.deleteById("1");
    expect(orm.users.O_findMany({ includeDeleted: true })).toHaveLength(1);
  });

  test("deleteWhere sets deletedAt", () => {
    orm.users.deleteWhere({ name: { eq: "a" } });
    const row = orm.users.O_findOne({ includeDeleted: true });
    expect(row!.deletedAt).toBeTypeOf("number");
  });
});
