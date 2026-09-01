import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Optional, Integer } from "typebox";
import { createORM, table } from "../src/index.ts";

const Doc = Object({ id: String(), title: String(), body: String(), views: Integer() });
const DocSoft = Object({ id: String(), title: String(), body: String(), views: Integer(), deletedAt: Optional(Integer()) });

function makeORM() {
  return createORM({
    tables: { docs: table(Doc, (s) => ({ primaryKey: s.id, fts: { columns: [s.title, s.body] } })) },
  });
}
function makeSoftORM() {
  return createORM({
    tables: { docs: table(DocSoft, (s) => ({ primaryKey: s.id, fts: { columns: [s.title, s.body] }, softDelete: { column: "deletedAt" } })) },
  });
}

function hits(orm: any, term: string): number {
  const rows = orm.docs.raw(
    `SELECT count(*) AS c FROM "_foxdb_fts_docs" f JOIN "docs" b ON b.rowid = f.rowid WHERE "_foxdb_fts_docs" MATCH ?`, term
  );
  return Number(rows[0].c);
}

describe("fts sync", () => {
  let orm: ReturnType<typeof makeORM>;
  beforeEach(() => { orm = makeORM(); });
  afterEach(() => orm._close());

  test("insert indexes the row", () => {
    orm.docs.insert({ id: "1", title: "quick fox", body: "lazy dog", views: 1 });
    expect(hits(orm, "fox")).toBe(1);
  });
  test("insertMany indexes all rows", () => {
    orm.docs.insertMany([{ id: "1", title: "alpha", body: "one", views: 0 }, { id: "2", title: "beta", body: "two", views: 0 }]);
    expect(hits(orm, "alpha")).toBe(1);
    expect(hits(orm, "beta")).toBe(1);
  });
  test("update re-syncs (old term gone, new term present)", () => {
    orm.docs.insert({ id: "1", title: "quick fox", body: "x", views: 0 });
    orm.docs.update({ id: "1", title: "quick eagle" });
    expect(hits(orm, "fox")).toBe(0);
    expect(hits(orm, "eagle")).toBe(1);
  });
  test("update that does not touch fts columns leaves index intact", () => {
    orm.docs.insert({ id: "1", title: "quick fox", body: "x", views: 1 });
    orm.docs.update({ id: "1", views: 2 });
    expect(hits(orm, "fox")).toBe(1);
  });
  test("updateWhere re-syncs", () => {
    orm.docs.insert({ id: "1", title: "cat", body: "b", views: 0 });
    orm.docs.insert({ id: "2", title: "cat", body: "b", views: 0 });
    orm.docs.updateWhere({ where: { title: { eq: "cat" } }, data: { title: "dog" } });
    expect(hits(orm, "cat")).toBe(0);
    expect(hits(orm, "dog")).toBe(2);
  });
  test("upsert inserts then updates the index", () => {
    orm.docs.upsert({ data: { id: "1", title: "one fish", body: "b", views: 0 }, conflictTarget: "id" });
    expect(hits(orm, "fish")).toBe(1);
    orm.docs.upsert({ data: { id: "1", title: "two bird", body: "b", views: 0 }, conflictTarget: "id" });
    expect(hits(orm, "fish")).toBe(0);
    expect(hits(orm, "bird")).toBe(1);
  });
  test("upsertMany syncs", () => {
    orm.docs.upsertMany({ data: [{ id: "1", title: "red", body: "b", views: 0 }, { id: "2", title: "blue", body: "b", views: 0 }], conflictTarget: "id" });
    expect(hits(orm, "red")).toBe(1);
    orm.docs.upsertMany({ data: [{ id: "1", title: "green", body: "b", views: 0 }], conflictTarget: "id" });
    expect(hits(orm, "red")).toBe(0);
    expect(hits(orm, "green")).toBe(1);
  });
  test("hard deleteById removes from index", () => {
    orm.docs.insert({ id: "1", title: "removeme", body: "b", views: 0 });
    orm.docs.deleteById("1");
    expect(hits(orm, "removeme")).toBe(0);
  });
  test("hard deleteWhere removes from index", () => {
    orm.docs.insert({ id: "1", title: "purge", body: "b", views: 0 });
    orm.docs.insert({ id: "2", title: "purge", body: "b", views: 0 });
    orm.docs.deleteWhere({ title: { eq: "purge" } });
    expect(hits(orm, "purge")).toBe(0);
  });
  test("flush clears the index", () => {
    orm.docs.insert({ id: "1", title: "flushme", body: "b", views: 0 });
    orm.docs.flush();
    expect(hits(orm, "flushme")).toBe(0);
  });
  test("soft delete keeps the row in the physical index (search-time exclusion is separate)", () => {
    const s = makeSoftORM();
    s.docs.insert({ id: "1", title: "softy", body: "b", views: 0 });
    s.docs.deleteById("1");
    expect(hits(s, "softy")).toBe(1);
    s._close();
  });
});
