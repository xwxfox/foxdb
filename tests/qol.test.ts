import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { Object, String } from "typebox";
import { createORM, table } from "../src/index.ts";
import os from "node:os";
const tmpDb = os.tmpdir() + "/foxdb_qol_test.db";

const UserSchema = Object({ id: String(), name: String() });

describe("QoL options", () => {
  afterEach(() => {
    for (const p of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
      if (existsSync(p)) unlinkSync(p);
    }
  });

  test("rebuildOnLaunch deletes old db", () => {
    const orm1 = createORM({
      path: tmpDb,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm1.users.insert({ id: "1", name: "A" });
    orm1._close();
    expect(existsSync(tmpDb)).toBe(true);

    const orm2 = createORM({
      path: tmpDb,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
      rebuildOnLaunch: true,
    });
    expect(orm2.users.findById("1")).toBeNull();
    orm2._close();
  }, 10000);

  test("seed runs after ready", () => {
    let seeded = false;
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
      seed: (o) => {
        o.users.insert({ id: "s1", name: "Seeded" });
        seeded = true;
      },
    });
    expect(seeded).toBe(true);
    expect(orm.users.findById("s1")).not.toBeNull();
    orm._close();
  });

  test("flushOnStart clears data before seed", () => {
    const orm1 = createORM({
      path: tmpDb,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm1.users.insert({ id: "1", name: "A" });
    orm1._close();

    const orm2 = createORM({
      path: tmpDb,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
      flushOnStart: ["users"],
      seed: (o) => {
        o.users.insert({ id: "2", name: "B" });
      },
    });
    expect(orm2.users.findById("1")).toBeNull();
    expect(orm2.users.findById("2")).not.toBeNull();
    orm2._close();
  }, 10000);

  test("unlinkDbFilesOnExit removes files on close", async () => {
    const orm = createORM({
      path: tmpDb,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
      unlinkDbFilesOnExit: true,
    });
    orm.users.insert({ id: "1", name: "A" });
    orm._close();
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(tmpDb)).toBe(false);
  });
});
