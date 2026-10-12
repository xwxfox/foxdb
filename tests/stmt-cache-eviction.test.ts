import { describe, test, expect } from "bun:test";
import { Object, String, Union, Null, Optional } from "typebox";
import { createORM, table } from "../src/index.ts";
import { BunDatabase } from "../src/database.ts";
import { QueryExecutor } from "../src/query-executor.ts";

/**
 * Statement-cache eviction must never strand live statement holders.
 *
 * BunDatabase.prepare() keeps a shared FIFO cache (256 entries) while each
 * QueryExecutor keeps its own unbounded cache of the SAME statement
 * objects. Evicting+finalizing from the shared cache used to poison every
 * other holder: all later uses threw "Statement has finalized" - sticky,
 * until process restart. In production this 500'd API endpoints at random
 * once traffic exceeded 256 distinct SQL shapes.
 */

const ItemSchema = Object({
  id: String(),
  name: String(),
});

function inList(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `missing-${i}`);
}

describe("statement cache eviction", () => {
  test("executor statements survive shared-cache eviction", () => {
    const db = new BunDatabase({ path: ":memory:" });
    db.exec(`CREATE TABLE "t" ("id" TEXT PRIMARY KEY, "val" INTEGER)`);
    db.prepare(`INSERT INTO "t" VALUES (?,?)`).run("a", 1);

    const a = new QueryExecutor({ db, tableName: "t" });
    const b = new QueryExecutor({ db, tableName: "t" });

    // Baseline through executor A (cached in both caches).
    expect(a.all(`SELECT * FROM "t" WHERE "id" = ?`, ["a"])).toHaveLength(1);

    // Flood past the 256-entry shared cap through executor B.
    for (let n = 1; n <= 300; n++) {
      b.all(`SELECT * FROM "t" WHERE "id" IN (${inList(n).map(() => "?").join(",")})`, inList(n));
    }

    // The baseline statement must still work - not "Statement has finalized".
    expect(a.all(`SELECT * FROM "t" WHERE "id" = ?`, ["a"])).toHaveLength(1);
    db.close();
  });

  test("open iterate() generators survive shared-cache eviction", () => {
    const db = new BunDatabase({ path: ":memory:" });
    db.exec(`CREATE TABLE "t" ("id" TEXT PRIMARY KEY, "val" INTEGER)`);
    for (let i = 0; i < 10; i++) db.prepare(`INSERT INTO "t" VALUES (?,?)`).run(`k${i}`, i);

    const ex = new QueryExecutor({ db, tableName: "t" });
    const gen = ex.iterate(`SELECT * FROM "t" ORDER BY "id"`);
    expect(gen.next().done).toBe(false);

    // Heavy distinct-shape traffic while the generator is open.
    for (let n = 1; n <= 300; n++) {
      ex.all(`SELECT * FROM "t" WHERE "id" IN (${inList(n).map(() => "?").join(",")})`, inList(n));
    }

    // Draining must not throw "Statement has finalized".
    let count = 1;
    for (const _ of gen) count++;
    expect(count).toBe(10);
    db.close();
  });

  test("executor transparently recovers a finalized cached statement", () => {
    const db = new BunDatabase({ path: ":memory:" });
    db.exec(`CREATE TABLE "t" ("id" TEXT PRIMARY KEY, "val" INTEGER)`);
    db.prepare(`INSERT INTO "t" VALUES (?,?)`).run("a", 1);

    const ex = new QueryExecutor({ db, tableName: "t" });
    const sql = `SELECT * FROM "t" WHERE "id" = ?`;
    expect(ex.all(sql, ["a"])).toHaveLength(1);

    // Simulate out-of-band finalization (e.g. a manual finalize on a
    // shared statement): the next use must recover, not throw.
    (ex as any).stmtCache.get(sql)?.finalize();
    expect(ex.all(sql, ["a"])).toHaveLength(1);
    expect(ex.get(sql, ["a"])).toMatchObject({ id: "a" });
    db.close();
  });

  test("ORM-level: repeated findMany shapes do not poison earlier ones", () => {
    const orm = createORM({
      path: ":memory:",
      tables: {
        items: table(ItemSchema, (s) => ({ primaryKey: s.id })),
      },
    });
    orm.items.insert({ id: "acme", name: "Acme" });

    const baseline = () => orm.items.findMany().like("name", "%acme%").exec();
    expect(baseline()).toHaveLength(1);

    for (let n = 1; n <= 300; n++) {
      orm.items.findMany().in("id", inList(n)).exec();
    }

    expect(baseline()).toHaveLength(1);
    orm._close();
  });
});

describe("nullable-union object decode (0.1.2 parity)", () => {
  const DocSchema = Object({
    id: String(),
    finance: Union([Object({ currency: String(), blocked: String() }), Null()]),
    optMeta: Optional(Object({ note: String() })),
  });

  test("Union([Object, Null]) hydrates to an object, not a JSON string", () => {
    const orm = createORM({
      path: ":memory:",
      tables: { docs: table(DocSchema, (s) => ({ primaryKey: s.id })) },
    });
    // NOTE: flattened Optional(Object) children are NOT NULL columns in both
    // 0.1.2 and current (missing object fails insert) - always provide it.
    orm.docs.insert({ id: "1", finance: { currency: "EUR", blocked: "no" }, optMeta: { note: "n/a" } });
    orm.docs.insert({ id: "2", finance: null, optMeta: { note: "hi" } });

    const one = orm.docs.findById("1")!;
    expect(one.finance).toEqual({ currency: "EUR", blocked: "no" });

    const two = orm.docs.findById("2")!;
    expect(two.finance).toBeNull();
    expect(two.optMeta).toEqual({ note: "hi" });
    orm._close();
  });
});
