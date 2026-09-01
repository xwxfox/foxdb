import { describe, test, expect, afterEach } from "bun:test";
import { Object, String } from "typebox";
import { createORM, table } from "../src/index.ts";
import { unlinkDbFiles } from "../src/database.ts";

const S = Object({ id: String(), title: String(), body: String() });
const PATH = "./_fts_drift_test.db";

describe("fts schema drift", () => {
  afterEach(() => unlinkDbFiles(PATH));

  test("reopening an fts table with sync:error does not report drift, and index still works", () => {
    const orm = createORM({ path: PATH, rebuildOnLaunch: true, tables: { docs: table(S, (s) => ({ primaryKey: s.id, fts: true })) } });
    orm.docs.insert({ id: "1", title: "hello", body: "world" });
    orm._close();

    const orm2 = createORM({ path: PATH, sync: "error", tables: { docs: table(S, (s) => ({ primaryKey: s.id, fts: true })) } });
    expect(orm2.docs.search("hello").exec()).toHaveLength(1);
    orm2._close();
  });
});
