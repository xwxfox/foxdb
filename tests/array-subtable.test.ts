import { describe, test, expect, beforeEach } from "bun:test";
import { Type } from "typebox";
import { createORM, table } from "../src/index.ts";

function makeORM() {
  const Schema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    tags: Type.Array(Type.String()),
    scores: Type.Array(Type.Number()),
    active: Type.Boolean(),
  });

  return createORM({
    path: ":memory:",
    tables: {
      users: table(Schema, (s) => ({
        primaryKey: s.id,
      })),
    },
    rebuildOnLaunch: true,
  });
}
describe("scalar array sub-tables", () => {


  let orm: ReturnType<typeof makeORM>;

  beforeEach(() => {
    orm = makeORM()

    orm.users.insert({ id: "u1", name: "alice", tags: ["ts", "js", "go"], scores: [95, 88], active: true });
    orm.users.insert({ id: "u2", name: "bob", tags: ["py", "js"], scores: [72], active: true });
    orm.users.insert({ id: "u3", name: "carol", tags: ["rust"], scores: [], active: false });
    orm.users.insert({ id: "u4", name: "dave", tags: [], scores: [100], active: true });
  });

  test("insert and read back scalar arrays", () => {
    const users = orm.users;
    const u1 = users.findById("u1")!;
    expect(u1.tags).toEqual(["ts", "js", "go"]);
    expect(u1.scores).toEqual([95, 88]);

    const u3 = users.findById("u3")!;
    expect(u3.tags).toEqual(["rust"]);
    expect(u3.scores).toEqual([]);
  });

  test("chain API arraySome works", () => {
    const results = orm.users
      .findMany()
      .arraySome("tags", "py")
      .exec();
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("u2");
  });

  test("chain API arrayNone works", () => {
    const results = orm.users
      .findMany()
      .arrayNone("tags", "ts")
      .exec();
    expect(results).toHaveLength(3);
  });

  test("chain API isEmpty works", () => {
    const results = orm.users
      .findMany()
      .isEmpty("scores")
      .exec();
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("u3");
  });

  test("chain API isNotEmpty works", () => {
    const results = orm.users
      .findMany()
      .isNotEmpty("scores")
      .exec();
    expect(results).toHaveLength(3);
  });

  test("array filter combined with scalar filter", () => {
    const results = orm.users
      .findMany()
      .arraySome("tags", "js")
      .equals("active", true)
      .exec();
    expect(results).toHaveLength(2);
    const ids = results.map((r: any) => r.id).sort();
    expect(ids).toEqual(["u1", "u2"]);
  });

  test("update with scalar arrays", () => {
    const users = orm.users as any;
    users.update({ id: "u4", name: "dave", tags: ["newtag"], scores: [99] });
    const u4 = users.findById("u4")!;
    expect(u4.tags).toEqual(["newtag"]);
    expect(u4.scores).toEqual([99]);
  });

  test("delete cascades to scalar array sub-tables", () => {
    const users = orm.users;
    users.deleteById("u1");
    const u1 = users.findById("u1");
    expect(u1).toBeNull();
    const all = users.O_findMany();
    expect(all).toHaveLength(3);
  });
});
