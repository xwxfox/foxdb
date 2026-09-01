# Examples

Real-world patterns you can copy-paste into your project.

## E-Commerce Domain

A small store with products, orders, and line items.

```typescript
import { Object, String, Number, Integer, Array, Optional } from "typebox";
import { createORM, table } from "@xwxfox/foxdb";

const ProductSchema = Object({
  sku: String(),
  name: String(),
  price: Number(),
  stock: Integer(),
});

const OrderSchema = Object({
  id: String(),
  customerId: String(),
  status: String(),
  total: Number(),
  lineItems: Array(
    Object({
      sku: String(),
      qty: Integer(),
      price: Number(),
    })
  ),
});

const orm = createORM({
  tables: {
    products: table(ProductSchema, (s) => ({
      primaryKey: s.sku,
      indexes: [{ columns: [s.name] }],
    })),
    orders: table(OrderSchema, (s) => ({
      primaryKey: s.id,
      indexes: [{ columns: [s.customerId] }, { columns: [s.status] }],
      timestamps: true,
    })),
  },
  relations: (r) => [
    r.from("orders")
      .subTable("lineItems", "sku")
      .to("products", "sku", { as: "product" }),
  ],
});

// seed
orm.products.insertMany([
  { sku: "WIDGET", name: "widget", price: 9.99, stock: 100 },
  { sku: "GADGET", name: "gadget", price: 24.99, stock: 50 },
]);

// place an order
orm.orders.insert({
  id: "ord-1",
  customerId: "cust-1",
  status: "pending",
  total: 34.98,
  lineItems: [
    { sku: "WIDGET", qty: 1, price: 9.99 },
    { sku: "GADGET", qty: 1, price: 24.99 },
  ],
});

// resolve relations
const order = orm.orders.findById("ord-1");
for (const item of order.lineItems) {
  console.log(item.product.name); // "widget" or "gadget"
}
```

## Audit Log with Events

Use the event bus to write an audit log without touching your repositories.

```typescript
const orm = createORM({
  tables: {
    users: table(UserSchema, (s) => ({ primaryKey: s.id })),
    audit: table(
      Object({
        id: String(),
        table: String(),
        op: String(),
        json: String(),
      }),
      (s) => ({ primaryKey: s.id, timestamps: true })
    ),
  },
});

// zero-overhead unless subscribed
orm._events.on("users", "write", (e) => {
  orm.audit.insert({
    id: crypto.randomUUID(),
    table: e.table,
    op: e.operation,
    json: JSON.stringify(e.data),
  });
});
```

## Table Flushing

Flush a table on shutdown:

```typescript
createORM({
  tables: {
    sessions: table(SessionSchema, (s) => ({ primaryKey: s.id })),
  },
  flushOnExit: ["sessions"], // truncate before close
  unlinkDbFilesOnExit: true,  // clean up .db files too
});
```

## Soft Deletes

Use soft deletes to keep deleted rows recoverable:

```typescript
const orm = createORM({
  tables: {
    users: table(UserSchema, (s) => ({
      primaryKey: s.id,
      softDelete: { column: "deletedAt" },
    })),
  },
});

// regular queries exclude soft-deleted rows automatically
const active = orm.users.O_findMany({ where: { status: { eq: "active" } } });

// include soft-deleted rows when needed
const all = orm.users.O_findMany({
  where: { status: { eq: "active" } },
  includeDeleted: true,
});
```

## Migrations

Auto-run migrations on startup:

```typescript
// migrations/001-init.ts
import type { Migration } from "@xwxfox/foxdb";

export default {
  name: "init",
  up(db) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)");
  },
} satisfies Migration;
```

```typescript
createORM({
  tables: { /* ... */ },
  migrations: { dir: "./migrations" },
  autoMigrate: true,
});
```

## Pagination Helper

```typescript
function paginate<T>(
  repo: { findPage: (opts: any) => PageResult<T> },
  where: any,
  pageSize: number
) {
  let offset = 0;
  return {
    next() {
      const page = repo.findPage({ where, limit: pageSize, offset });
      offset += pageSize;
      return page;
    },
  };
}

const pager = paginate(orm.users, { age: { gte: 18 } }, 10);
let page = pager.next();
while (page.data.length > 0) {
  console.log(page.data);
  page = pager.next();
}
```
