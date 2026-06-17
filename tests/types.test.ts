/**
 * foxdb/tests/types.test.ts
 * Compile-time type safety checks.
 * If this file compiles with tsc --noEmit, all tests pass.
 */

import { Object, String, Number, Integer, Optional, Array } from "typebox";
import { table } from "../src/table.ts";
import { createColumnProxy } from "../src/columns.ts";
import { createORM } from "../src/orm.ts";

const ItemSchema = Object({
  sku: String(),
  name: String(),
  price: Number(),
  stock: Integer(),
});

// ─── Valid config ─────────────────────────────────────────────────────────────

const valid = table(ItemSchema, (s) => ({
  primaryKey: s.sku,
  indexes: [{ columns: [s.name, s.price] }],
}));

void valid;

// ─── Invalid primaryKey should error at property access ───────────────────────

const cols = createColumnProxy(ItemSchema);
// @ts-expect-error - "nonExistent" is not a scalar column
void cols.nonExistent;

// ─── Invalid index column should error at property access ─────────────────────

// @ts-expect-error - "nonExistent" is not a scalar column
void cols.nonExistent;

// ─── Sub-table in index should error ──────────────────────────────────────────

const WithSub = Object({
  id: String(),
  tags: Array(Object({ label: String() })),
});

const subCols = createColumnProxy(WithSub);
// @ts-expect-error - tags is an array (sub-table), not a scalar
void subCols.tags;

// ─── select projection narrows return type ────────────────────────────────────

function _compileTimeChecks() {
  const UserSchema = Object({ id: String(), name: String(), age: Number() });
  const users = table(UserSchema, (s) => ({ primaryKey: s.id }));
  const orm = createORM({ tables: { users } });

  const projected = orm.users.O_findMany({ select: ["id"] });
  // @ts-expect-error - name was not selected
  void projected[0].name;

  // ─── select + include preserves sub-table types ───────────────────────────────

  const OrderSchema = Object({
    id: String(),
    total: Number(),
    lineItems: Array(Object({ sku: String(), qty: Integer() })),
  });
  const orders = table(OrderSchema, (s) => ({ primaryKey: s.id }));
  const orderOrm = createORM({ tables: { orders } });

  const withItems = orderOrm.orders.O_findMany({ select: ["id", "total"], include: ["lineItems"] });
  const firstOrder = withItems[0]!;
  const _id: string = firstOrder.id;
  const _total: number = firstOrder.total;
  const _sku: string = firstOrder.lineItems[0]!.sku;
  // @ts-expect-error - name is not a scalar column on OrderSchema
  void firstOrder.name;
  // @ts-expect-error - lineItems[0].wrong is not a property
  void firstOrder.lineItems[0]!.wrong;

  orderOrm._close();

  // ─── iterate yields entities ──────────────────────────────────────────────────

  for (const u of orm.users.O_iterate()) {
    const _id: string = u.id;
    void _id;
  }

  // ─── aggregate returns dynamic shape ──────────────────────────────────────────

  const agg = orm.users.O_aggregate({ aggregations: { total: { sum: "age" } } });
  // @ts-expect-error - wrong aggregation alias
  void agg[0].wrong;

  orm._close();

  // ─── JSON path dotted paths are accepted in where clauses ─────────────────────

  const NestedSchema = Object({
    id: Number(),
    pricing: Object({ total: Number(), currency: String() }),
    status: Object({ group: String(), blocked: Boolean() }),
  });
  const nested = table(NestedSchema, (s) => ({ primaryKey: s.id }));
  const nestedOrm = createORM({ tables: { nested } });

  // Dotted paths should be accepted
  nestedOrm.nested.O_findMany({ where: { "pricing.total": { gt: 100 } } });
  nestedOrm.nested.O_findMany({ where: { "status.group": { eq: "active" } } });
  nestedOrm.nested.O_findMany({ where: { "pricing.currency": { in: ["DKK", "EUR"] } } });

  // Direct nested object comparison should still work
  nestedOrm.nested.O_findMany({ where: { pricing: { eq: { total: 100, currency: "DKK" } } } });

  // @ts-expect-error - "pricing.nonexistent" is not a valid dotted path
  void nestedOrm.nested.O_findMany({ where: { "pricing.nonexistent": { gt: 100 } } });

  nestedOrm._close();

  // ─── Depth-2 JSON path dotted paths are accepted in where clauses ─────────────

  const Depth2Schema = Object({
    id: Number(),
    address: Object({
      city: Object({ zip: String(), name: String() }),
    }),
  });
  const depth2 = table(Depth2Schema, (s) => ({ primaryKey: s.id }));
  const depth2Orm = createORM({ tables: { depth2 } });

  // Valid depth-2 dotted paths should be accepted
  depth2Orm.depth2.O_findMany({ where: { "address.city.zip": { eq: "12345" } } });
  depth2Orm.depth2.O_findMany({ where: { "address.city.name": { like: "%York%" } } });
  depth2Orm.depth2.O_findMany({ where: { "address.city.zip": { in: ["12345", "67890"] } } });

  // @ts-expect-error - "address.city.nonexistent" is not a valid depth-2 dotted path
  void depth2Orm.depth2.O_findMany({ where: { "address.city.nonexistent": { eq: "x" } } });

  // @ts-expect-error - "address.nonexistent.zip" is not a valid depth-2 dotted path
  void depth2Orm.depth2.O_findMany({ where: { "address.nonexistent.zip": { eq: "x" } } });

  depth2Orm._close();
}
