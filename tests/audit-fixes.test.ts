/**
 * foxdb/tests/audit-fixes.test.ts
 * Regression tests for the 10 audit issues identified in the gap analysis review.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number, Integer, Optional, Array } from "typebox";
import { createORM, table } from "../src/index.ts";
import { TableScheduler } from "../src/scheduler.ts";

// ─── Issue 1: findMany with select + include must include PK implicitly ───────

const SaleSchema = Object({
  id: String(),
  total: Number(),
  lineItems: Array(Object({ sku: String() })),
});

describe("issue 1: select + include implicitly includes PK", () => {
  test("findMany with select and include hydrates sub-tables correctly", () => {
    const orm = createORM({
      tables: { sales: table(SaleSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.sales.insert({ id: "S1", total: 10, lineItems: [{ sku: "A" }] });
    const rows = orm.sales.findMany({ select: ["total"], include: ["lineItems"] });
    expect(rows).toHaveLength(1);
    const first = rows[0]!;
    expect(first.total).toBe(10);
    expect(first.lineItems).toHaveLength(1);
    expect(first.lineItems[0]!.sku).toBe("A");
    orm._close();
  });
});

// ─── Issue 2: iterate() with include is now supported ─────────────────────────

describe("issue 2: iterate with include works", () => {
  test("iterate() hydrates sub-tables in windows", () => {
    const orm = createORM({
      tables: { sales: table(SaleSchema, (s) => ({ primaryKey: s.id })) },
    });
    orm.sales.insert({ id: "S1", total: 10, lineItems: [{ sku: "A" }] });
    orm.sales.insert({ id: "S2", total: 20, lineItems: [{ sku: "B" }] });
    const results: Array<Record<string, unknown>> = [];
    for (const row of orm.sales.iterate({ include: ["lineItems"] })) {
      results.push(row as Record<string, unknown>);
    }
    expect(results).toHaveLength(2);
    expect(results[0]!.lineItems).toHaveLength(1);
    orm._close();
  });
});

// ─── Issue 3: BatchWriter must validate, apply codecs, timestamps, events ─────

const LogSchema = Object({ id: String(), payload: String(), createdAt: Optional(Number()), updatedAt: Optional(Number()) });

describe("issue 3: batch writer validates and applies codecs/timestamps", () => {
  test("batch writer applies timestamps and codecs", () => {
    const orm = createORM({
      tables: {
        logs: table(LogSchema, (s) => ({
          primaryKey: s.id,
          timestamps: true,
          compression: { columns: [s.payload], algorithm: "gzip" },
        })),
      },
    });
    const writer = orm.logs.createBatchWriter({ maxBuffer: 2 });
    writer.insert({ id: "1", payload: "hello" });
    // Not flushed yet (buffer has 1, maxBuffer is 2)
    expect(orm.logs.count()).toBe(0);
    writer.insert({ id: "2", payload: "world" });
    // Flushed automatically because buffer reached maxBuffer
    expect(orm.logs.count()).toBe(2);
    writer.close();
    const row = orm.logs.findById("1");
    expect(row).not.toBeNull();
    expect(row!.payload).toBe("hello");
    expect(row!.createdAt).toBeTypeOf("number");
    orm._close();
  });
});

// ─── Issue 4: aggregate must respect soft deletes ─────────────────────────────

const OrderSchema = Object({ id: String(), total: Number(), deletedAt: Optional(Integer()) });

describe("issue 4: aggregate respects soft deletes", () => {
  test("aggregate excludes soft-deleted rows by default", () => {
    const orm = createORM({
      tables: {
        orders: table(OrderSchema, (s) => ({
          primaryKey: s.id,
          softDelete: { column: "deletedAt" },
        })),
      },
    });
    orm.orders.insert({ id: "1", total: 10 });
    orm.orders.insert({ id: "2", total: 20 });
    orm.orders.insert({ id: "3", total: 30 });
    orm.orders.deleteById("2");

    const rows = orm.orders.aggregate({ aggregations: { sumTotal: { sum: "total" } } });
    expect(rows[0]!.sumTotal).toBe(40); // 10 + 30, not 60
    orm._close();
  });

  test("aggregate includeDeleted includes all rows", () => {
    const orm = createORM({
      tables: {
        orders: table(OrderSchema, (s) => ({
          primaryKey: s.id,
          softDelete: { column: "deletedAt" },
        })),
      },
    });
    orm.orders.insert({ id: "1", total: 10 });
    orm.orders.insert({ id: "2", total: 20 });
    orm.orders.deleteById("2");

    const rows = orm.orders.aggregate({ aggregations: { sumTotal: { sum: "total" } }, includeDeleted: true });
    expect(rows[0]!.sumTotal).toBe(30);
    orm._close();
  });
});

// ─── Issue 5: TableScheduler.clear(name) must stop timers ─────────────────────

describe("issue 5: scheduler clear stops timers", () => {
  test("clear(name) stops the specific timer", async () => {
    const scheduler = new TableScheduler();
    let countA = 0;
    let countB = 0;
    scheduler.schedule("a", 10, () => countA++);
    scheduler.schedule("b", 10, () => countB++);
    await new Promise((r) => setTimeout(r, 35));
    expect(countA).toBeGreaterThanOrEqual(2);
    expect(countB).toBeGreaterThanOrEqual(2);

    scheduler.clear("a");
    const beforeA = countA;
    const beforeB = countB;
    await new Promise((r) => setTimeout(r, 30));
    expect(countA).toBe(beforeA); // a should not have incremented
    expect(countB).toBeGreaterThan(beforeB); // b should still be running
    scheduler.clearAll();
  });
});

// ─── Issue 6: deleteWhere must not hard-delete sub-rows under soft delete ─────

const ParentSchema = Object({
  id: String(),
  children: Array(Object({ name: String() })),
  deletedAt: Optional(Integer()),
});

describe("issue 6: soft delete does not cascade to sub-tables", () => {
  test("deleteById with softDelete leaves sub-rows intact", () => {
    const orm = createORM({
      tables: {
        parents: table(ParentSchema, (s) => ({
          primaryKey: s.id,
          softDelete: { column: "deletedAt" },
        })),
      },
    });
    orm.parents.insert({ id: "1", children: [{ name: "alice" }] });
    orm.parents.deleteById("1");

    // Parent is soft-deleted
    expect(orm.parents.findMany()).toHaveLength(0);
    expect(orm.parents.findMany({ includeDeleted: true })).toHaveLength(1);

    // Sub-rows are still there when including deleted
    const withDeleted = orm.parents.findMany({ includeDeleted: true, include: ["children"] });
    expect(withDeleted[0]!.children).toHaveLength(1);
    orm._close();
  });
});

// ─── Issue 7: maxRows without lruColumn warns ─────────────────────────────────

describe("issue 7: maxRows without lruColumn warns", () => {
  test("console.warn is emitted", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

    const CacheSchema = Object({ id: String(), data: String() });
    const orm = createORM({
      tables: {
        cache: table(CacheSchema, (s) => ({
          primaryKey: s.id,
          eviction: { maxRows: 5 },
        })),
      },
    });

    expect(warnings.some((w) => w.includes("eviction.maxRows without lruColumn"))).toBe(true);
    console.warn = originalWarn;
    orm._close();
  });
});

// ─── Issue 8: upsert must reactivate soft-deleted rows ────────────────────────

describe("issue 8: upsert reactivates soft-deleted rows", () => {
  test("upsert on soft-deleted row clears deletedAt", () => {
    const orm = createORM({
      tables: {
        orders: table(OrderSchema, (s) => ({
          primaryKey: s.id,
          softDelete: { column: "deletedAt" },
        })),
      },
    });
    orm.orders.insert({ id: "1", total: 10 });
    orm.orders.deleteById("1");
    expect(orm.orders.findById("1")).toBeNull();

    // Upsert should reactivate the row
    orm.orders.upsert({ data: { id: "1", total: 20 }, conflictTarget: "id" });
    const row = orm.orders.findById("1");
    expect(row).not.toBeNull();
    expect(row!.total).toBe(20);
    orm._close();
  });
});

// ─── Issue 10: compressed columns get BLOB DDL ────────────────────────────────

describe("issue 10: compressed columns use BLOB DDL", () => {
  test("meta column sqlType is BLOB for gzip-compressed columns", () => {
    const orm = createORM({
      tables: {
        logs: table(LogSchema, (s) => ({
          primaryKey: s.id,
          compression: { columns: [s.payload], algorithm: "gzip" },
        })),
      },
    });
    const payloadCol = orm.logs.meta.columns.find((c) => c.name === "payload");
    expect(payloadCol!.sqlType).toBe("BLOB");
    orm._close();
  });
});
