import { describe, test, expect, afterEach } from "bun:test";
import { Object, String } from "typebox";
import { createORM, table } from "../src/index.ts";

const S = Object({ id: String(), customer: Object({ name: String(), city: String() }) });

describe("fts nested/flattened columns", () => {
  let orm: any;
  afterEach(() => orm?._close());

  test("fts:true indexes flattened nested string columns", () => {
    orm = createORM({ tables: { t: table(S, (s) => ({ primaryKey: s.id, fts: true as const })) } });
    orm.t.insert({ id: "1", customer: { name: "Ada Lovelace", city: "London" } });
    const rows = orm.t.search("Lovelace").exec();
    expect(rows).toHaveLength(1);
    expect(rows[0].customer.name).toBe("Ada Lovelace");
  });

  test("search by explicit nested flattened column ref", () => {
    orm = createORM({ tables: { t: table(S, (s) => ({ primaryKey: s.id, fts: { columns: [s.customer__name] } })) } });
    orm.t.insert({ id: "1", customer: { name: "Grace Hopper", city: "NYC" } });
    expect(orm.t.search("Hopper").exec()).toHaveLength(1);
    expect(orm.t.search("NYC").exec()).toHaveLength(0);
  });

  test("drop() removes the fts virtual table", () => {
    orm = createORM({ tables: { t: table(S, (s) => ({ primaryKey: s.id, fts: true as const })) } });
    orm.t.insert({ id: "1", customer: { name: "x", city: "y" } });
    orm.t.drop();
    const exists = orm.t.raw(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, "_foxdb_fts_t"
    );
    expect(exists).toHaveLength(0);
  });
});
