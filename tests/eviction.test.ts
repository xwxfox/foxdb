import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Integer } from "typebox";
import { createORM, table } from "../src/index.ts";

const CacheSchema = Object({
  id: String(),
  data: String(),
  createdAt: Integer(),
  lastAccessedAt: Integer(),
});

const ItemSchema = Object({
  id: String(),
  name: String(),
});

function makeORM() {
  return createORM({
    tables: {
      cache: table(CacheSchema, (s) => ({
        primaryKey: s.id,
        eviction: { maxRows: 5, ttlColumn: "createdAt", ttlMs: 100, lruColumn: "lastAccessedAt" },
      })),
    },
  });
}

describe("bounded tables", () => {
  let orm: ReturnType<typeof makeORM>;
  beforeEach(() => { orm = makeORM(); });
  afterEach(() => orm._close());

  test("eviction removes rows over maxRows automatically on insert", () => {
    for (let i = 0; i < 10; i++) {
      orm.cache.insert({ id: `${i}`, data: "x", createdAt: Date.now(), lastAccessedAt: Date.now() });
    }
    // Eviction should have run automatically after each insert
    expect(orm.cache.count()).toBeLessThanOrEqual(5);
  });

  test("eviction does not delete all rows when count < maxRows", () => {
    const orm2 = createORM({
      path: ":memory:",
      rebuildOnLaunch: true,
      tables: {
        items: table(ItemSchema, (s) => ({
          primaryKey: s.id,
          eviction: { maxRows: 10 },
        })),
      },
    });
    // Insert 5 rows (below maxRows of 10)
    for (let i = 1; i <= 5; i++) {
      orm2.items.insert({ id: `${i}`, name: `item-${i}` });
    }
    expect(orm2.items.count()).toBe(5);
    // Trigger eviction by inserting one more
    orm2.items.insert({ id: "6", name: "item-6" });
    expect(orm2.items.count()).toBe(6); // Should still be 6, not 0
    orm2._close();
  });
});
