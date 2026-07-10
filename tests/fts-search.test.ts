import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Optional, Integer } from "typebox";
import { createORM, table } from "../src/index.ts";

const Doc = Object({ id: String(), title: String(), body: String(), views: Integer() });
const DocSoft = Object({ id: String(), title: String(), body: String(), views: Integer(), deletedAt: Optional(Integer()) });

function makeORM() {
  return createORM({ tables: { docs: table(Doc, (s) => ({ primaryKey: s.id, fts: { columns: [s.title, s.body] } })) } });
}
function makeSoftORM() {
  return createORM({ tables: { docs: table(DocSoft, (s) => ({ primaryKey: s.id, fts: { columns: [s.title, s.body] }, softDelete: { column: "deletedAt" } })) } });
}

describe("fts search", () => {
  let orm: ReturnType<typeof makeORM>;
  beforeEach(() => {
    orm = makeORM();
    orm.docs.insertMany([
      { id: "1", title: "the quick brown fox", body: "jumps over the lazy dog", views: 1 },
      { id: "2", title: "slow green turtle", body: "quick nap in the sun", views: 2 },
      { id: "3", title: "red bird", body: "sings a song", views: 3 },
    ]);
  });
  afterEach(() => orm._close());

  test("returns full entities matching the term", () => {
    const rows = orm.docs.search("quick").exec();
    expect(rows.map((r) => r.id).sort()).toEqual(["1", "2"]);
    const first = rows[0]!;
    expect(first.title).toBeTypeOf("string");
    expect(first.views).toBeTypeOf("number");
  });
  test("attaches _score ordered by relevance (ascending bm25)", () => {
    const rows = orm.docs.search("quick").exec();
    const first = rows[0]!;
    expect(first._score).toBeTypeOf("number");
    for (let i = 1; i < rows.length; i++) expect(rows[i]!._score).toBeGreaterThanOrEqual(rows[i - 1]!._score);
  });
  test("limit/offset", () => {
    expect(orm.docs.search("quick").limit(1).exec()).toHaveLength(1);
    expect(orm.docs.search("quick").limit(1).offset(1).exec()).toHaveLength(1);
  });
  test("no matches → empty array", () => {
    expect(orm.docs.search("zebra").exec()).toEqual([]);
  });
  test("column weights change ranking (title-heavy ranks doc 1 first)", () => {
    const rows = orm.docs.search("quick").weights({ title: 10, body: 0.1 }).exec();
    expect(rows[0]!.id).toBe("1");
  });
  test("snippet + highlight", () => {
    const rows = orm.docs.search("fox").snippet("body").highlight("title").exec();
    const first = rows[0]!;
    expect(first._highlight.title).toContain("[");
    expect(first._snippet.body).toBeTypeOf("string");
  });
  test("extra where predicate ANDs with MATCH", () => {
    const rows = orm.docs.search("quick").where((q) => q.equals("id", "1")).exec();
    expect(rows.map((r) => r.id)).toEqual(["1"]);
  });
  test("execAsync resolves to same result", async () => {
    const rows = await orm.docs.search("quick").execAsync();
    expect(rows.map((r) => r.id).sort()).toEqual(["1", "2"]);
  });
  test("searchAsync convenience", async () => {
    const rows = await orm.docs.searchAsync("quick");
    expect(rows.map((r) => r.id).sort()).toEqual(["1", "2"]);
  });
  test("soft-deleted rows excluded unless includeDeleted", () => {
    const s = makeSoftORM();
    s.docs.insert({ id: "9", title: "quick shadow", body: "b", views: 0 });
    s.docs.deleteById("9");
    expect(s.docs.search("shadow").exec()).toHaveLength(0);
    expect(s.docs.search("shadow").includeDeleted().exec()).toHaveLength(1);
    s._close();
  });
});
