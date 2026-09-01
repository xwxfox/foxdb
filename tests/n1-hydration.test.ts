import { describe, test, expect } from "bun:test";
import { Object, String, Array } from "typebox";
import { createORM, table } from "../src/index.ts";

describe("N+1 safe hydration", () => {
  test("findMany with include batches sub-table queries", () => {
    const saleSchema = Object({ id: String(), lineItems: Array(Object({ sku: String() })) });
    const orm = createORM({ tables: { sales: table(saleSchema, (s) => ({ primaryKey: s.id })) } });
    for (let i = 0; i < 100; i++) {
      orm.sales.insert({ id: `${i}`, lineItems: [{ sku: "A" }] });
    }
    const all = orm.sales.O_findMany({ include: ["lineItems"] });
    expect(all).toHaveLength(100);
    expect(all[0]!.lineItems).toHaveLength(1);
    orm._close();
  });
});
