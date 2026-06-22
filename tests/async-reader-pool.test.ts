import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number } from "typebox";
import { createORM, table } from "../src/index.ts";
import os from "node:os";
import { existsSync, unlinkSync } from "node:fs";

const tmpDb = os.tmpdir() + "/foxdb_async_pool_test.db";

const UserSchema = Object({ id: String(), name: String(), age: Number() });
const simpleSchema = Object({ id: String(), label: String() });

function rmTmp() {
  for (const p of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    if (existsSync(p)) unlinkSync(p);
  }
}

// --- Fallback tests (no asyncReaderPool, uses sync via Promise.resolve) ------

describe("async methods without pool (fallback)", () => {
  test("O_findManyAsync falls back to sync", async () => {
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 25 });
    const rows = await orm.users.O_findManyAsync();
    expect(rows).toHaveLength(2);
    orm._close();
  });

  test("O_findOneAsync falls back to sync", async () => {
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    const row = await orm.users.O_findOneAsync({ where: { name: { eq: "alice" } } });
    expect(row).not.toBeNull();
    expect(row!.name).toBe("alice");
    orm._close();
  });

  test("O_findPageAsync falls back to sync", async () => {
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 25 });
    const page = await orm.users.O_findPageAsync({ limit: 1, offset: 0 });
    expect(page.data).toHaveLength(1);
    expect(page.total).toBe(2);
    orm._close();
  });

  test("O_findCursorPageAsync falls back to sync", async () => {
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 25 });
    const page = await orm.users.O_findCursorPageAsync({
      orderBy: { column: "id", direction: "ASC" },
      limit: 1,
    });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]!.name).toBe("alice");
    orm._close();
  });

  test("O_countAsync falls back to sync", async () => {
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    const c = await orm.users.O_countAsync();
    expect(c).toBe(1);
    orm._close();
  });

  test("O_aggregateAsync falls back to sync", async () => {
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 20 });
    const result = await orm.users.O_aggregateAsync({
      aggregations: { avgAge: { avg: "age" } },
    });
    expect(result[0]!.avgAge).toBe(25);
    orm._close();
  });

  test("O_windowQueryAsync falls back to sync", async () => {
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 25 });
    const result = await orm.users.O_windowQueryAsync({
      select: { rn: { rowNumber: true } },
      orderBy: [{ column: "age", direction: "DESC" }],
    });
    expect(result).toHaveLength(2);
    orm._close();
  });

  test("findByIdAsync falls back to sync", async () => {
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    const row = await orm.users.findByIdAsync("1");
    expect(row).not.toBeNull();
    expect(row!.name).toBe("alice");
    const missing = await orm.users.findByIdAsync("nope");
    expect(missing).toBeNull();
    orm._close();
  });

  test("rawAsync falls back to sync", async () => {
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    const rows = await orm.users.rawAsync<{ name: string }>(
      "SELECT name FROM users WHERE id = ?", "1"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("alice");
    orm._close();
  });

  test("chain api execAsync falls back to sync", async () => {
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 25 });
    const rows = await orm.users.findMany().equals("age", 30).execAsync();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("alice");
    const one = await orm.users.findOne().equals("name", "bob").execAsync();
    expect(one).not.toBeNull();
    expect(one!.name).toBe("bob");
    const c = await orm.users.count().execAsync();
    expect(c).toBe(2);
    orm._close();
  });

  test("findManyMaterializedAsync falls back to sync", async () => {
    const orm = createORM({
      path: ":memory:",
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    const rows = await orm.users.findManyMaterializedAsync();
    expect(rows).toHaveLength(1);
    orm._close();
  });
});

// --- File-based tests (with asyncReaderPool) ----------------------------------

describe("async methods with file-based asyncReaderPool", () => {
  beforeEach(rmTmp);
  afterEach(rmTmp);

  test("O_findManyAsync returns correct results", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 25 });
    orm.users.insert({ id: "3", name: "charlie", age: 35 });
    const rows = await orm.users.O_findManyAsync({ where: { age: { gte: 30 } } });
    expect(rows).toHaveLength(2);
    orm._close();
  });

  test("O_findOneAsync returns correct result", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    const row = await orm.users.O_findOneAsync({ where: { name: { eq: "alice" } } });
    expect(row).not.toBeNull();
    expect(row!.name).toBe("alice");
    const missing = await orm.users.O_findOneAsync({ where: { name: { eq: "nobody" } } });
    expect(missing).toBeNull();
    orm._close();
  });

  test("O_findPageAsync returns correct page", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    for (let i = 1; i <= 10; i++) {
      orm.users.insert({ id: `${i}`, name: `user${i}`, age: 20 + i });
    }
    const page = await orm.users.O_findPageAsync({ limit: 3, offset: 0 });
    expect(page.data).toHaveLength(3);
    expect(page.total).toBe(10);
    orm._close();
  });

  test("O_findCursorPageAsync returns correct data", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    for (let i = 1; i <= 5; i++) {
      orm.users.insert({ id: `${i}`, name: `user${i}`, age: 20 + i });
    }
    const page = await orm.users.O_findCursorPageAsync({
      orderBy: { column: "id", direction: "ASC" },
      limit: 2,
    });
    expect(page.data).toHaveLength(2);
    expect(page.data[0]!.name).toBe("user1");
    expect(page.nextCursor).not.toBeNull();
    orm._close();
  });

  test("O_countAsync returns correct count", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 25 });
    const c = await orm.users.O_countAsync({ age: { gte: 30 } });
    expect(c).toBe(1);
    orm._close();
  });

  test("O_aggregateAsync returns correct results", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 20 });
    orm.users.insert({ id: "3", name: "charlie", age: 40 });
    const result = await orm.users.O_aggregateAsync({
      aggregations: { total: { sum: "age" }, cnt: { count: "*" } },
    });
    expect(result[0]!.total).toBe(90);
    expect(result[0]!.cnt).toBe(3);
    orm._close();
  });

  test("O_windowQueryAsync returns correct data", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 25 });
    const result = await orm.users.O_windowQueryAsync({
      select: { rn: { rowNumber: true } },
      orderBy: [{ column: "age", direction: "DESC" }],
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.rn).toBe(1);
    orm._close();
  });

  test("findByIdAsync returns correct row", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    const row = await orm.users.findByIdAsync("1");
    expect(row).not.toBeNull();
    expect(row!.name).toBe("alice");
    orm._close();
  });

  test("rawAsync returns correct results", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    const rows = await orm.users.rawAsync<{ name: string }>(
      "SELECT name FROM users WHERE id = ?", "1"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("alice");
    orm._close();
  });

  test("chain api execAsync uses workers", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 25 });
    orm.users.insert({ id: "3", name: "charlie", age: 35 });

    const rows = await orm.users.findMany().greaterThanOrEqual("age", 30).execAsync();
    expect(rows).toHaveLength(2);

    const one = await orm.users.findOne().equals("name", "bob").execAsync();
    expect(one).not.toBeNull();
    expect(one!.name).toBe("bob");

    const c = await orm.users.count().execAsync();
    expect(c).toBe(3);

    orm._close();
  });

  test("chain api execAsync with pagination", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    for (let i = 1; i <= 10; i++) {
      orm.users.insert({ id: `${i}`, name: `user${i}`, age: 20 + i });
    }
    const page = await orm.users.findPage().limit(4).offset(0).execAsync();
    expect(page.data).toHaveLength(4);
    expect(page.total).toBe(10);
    orm._close();
  });

  test("chain api cursor page execAsync", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    for (let i = 1; i <= 5; i++) {
      orm.users.insert({ id: `${i}`, name: `user${i}`, age: 20 + i });
    }
    const page = await orm.users.findCursorPage().orderBy("id", "ASC").limit(2).execAsync();
    expect(page.data).toHaveLength(2);
    expect(page.data[0]!.name).toBe("user1");
    orm._close();
  });

  test("aggregateAsync chain api", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 20 });
    const result = await orm.users.aggregate().sum("age", "totalAge").count("*", "cnt").execAsync();
    expect(result[0]!.totalAge).toBe(50);
    expect(result[0]!.cnt).toBe(2);
    orm._close();
  });

  test("concurrent reads from multiple workers", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 4,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    for (let i = 1; i <= 100; i++) {
      orm.users.insert({ id: `${i}`, name: `user${i}`, age: i });
    }
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(orm.users.O_findManyAsync({ limit: 50 }));
    }
    const results = await Promise.all(promises);
    for (const rows of results) {
      expect(rows).toHaveLength(50);
    }
    orm._close();
  });

  test("writes unaffected by pool", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.flush();
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 25 });

    const rows = await orm.users.O_findManyAsync();
    expect(rows).toHaveLength(2);

    orm.users.update({ id: "1", name: "alice updated", age: 31 });
    const updated = await orm.users.findByIdAsync("1");
    expect(updated!.name).toBe("alice updated");

    orm.users.deleteById("2");
    const afterDelete = await orm.users.O_findManyAsync();
    expect(afterDelete).toHaveLength(1);

    orm._close();
  });

  test("results match sync versions", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.flush();
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm.users.insert({ id: "2", name: "bob", age: 25 });
    orm.users.insert({ id: "3", name: "charlie", age: 35 });

    const syncRows = orm.users.O_findMany({ where: { age: { gte: 30 } } });
    const asyncRows = await orm.users.O_findManyAsync({ where: { age: { gte: 30 } } });
    expect(asyncRows).toEqual(syncRows);

    const syncOne = orm.users.O_findOne({ where: { name: { eq: "bob" } } });
    const asyncOne = await orm.users.O_findOneAsync({ where: { name: { eq: "bob" } } });
    expect(asyncOne).toEqual(syncOne);

    const syncCount = orm.users.O_count();
    const asyncCount = await orm.users.O_countAsync();
    expect(asyncCount).toBe(syncCount);

    orm._close();
  });
});

// --- Simple file-based test without Number schema ---------------------------

describe("async pool with simple schema", () => {
  beforeEach(rmTmp);
  afterEach(rmTmp);

  test("basic read after write", async () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { items: table(simpleSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.items.insert({ id: "a1", label: "alpha" });
    orm.items.insert({ id: "b2", label: "beta" });
    const rows = await orm.items.O_findManyAsync();
    expect(rows).toHaveLength(2);
    const one = await orm.items.findByIdAsync("a1");
    expect(one).not.toBeNull();
    expect(one!.label).toBe("alpha");
    orm._close();
  });
});

// --- Clean termination -------------------------------------------------------

describe("pool termination", () => {
  beforeEach(rmTmp);
  afterEach(rmTmp);

  test("orm._close() terminates workers", () => {
    const orm = createORM({
      path: tmpDb,
      asyncReaderPool: 2,
      tables: { users: table(UserSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.users.insert({ id: "1", name: "alice", age: 30 });
    orm._close();
  });
});
