/**
 * foxdb/tests/metrics.test.ts
 * Tests for query metrics / observability hooks.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object as TObject, String, Number } from "typebox";
import { createORM, table } from "../src/index.ts";
import type { QueryMetrics } from "../src/types.ts";

const UserSchema = TObject({
  id: String(),
  name: String(),
  age: Number(),
});

describe("QueryMetrics hook", () => {
  test("onQuery receives metadata for reads", () => {
    const metrics: QueryMetrics[] = [];
    const orm = createORM({
      tables: {
        users: table(UserSchema, (s) => ({
          primaryKey: s.id,
        })),
      },
      hooks: {
        onQuery: (m) => metrics.push(m),
      },
    });

    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    orm.users.findById("u1");
    orm.users.O_findMany();

    const findByIdMetric = metrics.find((m) => m.operation === "findById");
    expect(findByIdMetric).toBeDefined();
    expect(findByIdMetric!.table).toBe("users");
    expect(findByIdMetric!.sql).toContain("SELECT");
    expect(findByIdMetric!.durationMs).toBeGreaterThanOrEqual(0);
    expect(findByIdMetric!.rowCount).toBe(1);

    const findManyMetric = metrics.find((m) => m.operation === "findMany");
    expect(findManyMetric).toBeDefined();
    expect(findManyMetric!.rowCount).toBe(1);

    orm._close();
  });

  test("onQuery receives metadata for writes", () => {
    const metrics: QueryMetrics[] = [];
    const orm = createORM({
      tables: {
        users: table(UserSchema, (s) => ({
          primaryKey: s.id,
        })),
      },
      hooks: {
        onQuery: (m) => metrics.push(m),
      },
    });

    orm.users.insert({ id: "u1", name: "alice", age: 30 });

    const insertMetric = metrics.find((m) => m.operation === "insert");
    expect(insertMetric).toBeDefined();
    expect(insertMetric!.table).toBe("users");
    expect(insertMetric!.sql).toContain("INSERT");
    expect(insertMetric!.durationMs).toBeGreaterThanOrEqual(0);

    orm._close();
  });

  test("onQuery receives metadata for aggregate", () => {
    const metrics: QueryMetrics[] = [];
    const orm = createORM({
      tables: {
        users: table(UserSchema, (s) => ({
          primaryKey: s.id,
        })),
      },
      hooks: {
        onQuery: (m) => metrics.push(m),
      },
    });

    orm.users.insert({ id: "u1", name: "alice", age: 30 });
    orm.users.O_aggregate({
      aggregations: { total: { count: "*" } },
    });

    const aggMetric = metrics.find((m) => m.operation === "aggregate");
    expect(aggMetric).toBeDefined();
    expect(aggMetric!.table).toBe("users");
    expect(aggMetric!.sql).toContain("SELECT");
    expect(aggMetric!.durationMs).toBeGreaterThanOrEqual(0);

    orm._close();
  });
});
