/**
 * foxdb/tests/batch-writer.test.ts
 * Tests for async batch writer.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object as TObject, String, Number } from "typebox";
import { createORM, table } from "../src/index.ts";

const UserSchema = TObject({
  id: String(),
  name: String(),
  age: Number(),
});

function makeTestORM() {
  return createORM({
    tables: {
      users: table(UserSchema, (s) => ({
        primaryKey: s.id,
      })),
    },
  });
}

describe("BatchWriter", () => {
  let orm: ReturnType<typeof makeTestORM>;

  beforeEach(() => {
    orm = makeTestORM();
  });

  afterEach(() => {
    orm._close();
  });

  test("buffers inserts and flushes on close", () => {
    const writer = orm.users.createBatchWriter({ maxBuffer: 10 });
    writer.insert({ id: "u1", name: "alice", age: 30 });
    writer.insert({ id: "u2", name: "bob", age: 25 });

    // Should not be flushed yet
    expect(orm.users.O_count()).toBe(0);

    writer.close();
    expect(orm.users.O_count()).toBe(2);

    const u1 = orm.users.findById("u1");
    expect(u1).not.toBeNull();
    expect(u1!.name).toBe("alice");
  });

  test("auto-flushes when buffer reaches maxBuffer", () => {
    const writer = orm.users.createBatchWriter({ maxBuffer: 3 });
    writer.insert({ id: "u1", name: "a", age: 1 });
    writer.insert({ id: "u2", name: "b", age: 2 });
    expect(orm.users.O_count()).toBe(0);

    writer.insert({ id: "u3", name: "c", age: 3 });
    expect(orm.users.O_count()).toBe(3);

    writer.close();
  });

  test("flush interval auto-flushes", async () => {
    const writer = orm.users.createBatchWriter({ maxBuffer: 1000, flushIntervalMs: 50 });
    writer.insert({ id: "u1", name: "a", age: 1 });

    expect(orm.users.O_count()).toBe(0);
    await new Promise((r) => setTimeout(r, 100));
    expect(orm.users.O_count()).toBe(1);

    writer.close();
  });

  test("handles many rows", () => {
    const writer = orm.users.createBatchWriter({ maxBuffer: 100 });
    for (let i = 0; i < 250; i++) {
      writer.insert({ id: `u${i}`, name: `user-${i}`, age: i });
    }
    writer.close();
    expect(orm.users.O_count()).toBe(250);
  });
});
