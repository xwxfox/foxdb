# Core Concepts

foxdb is designed around a few simple ideas that compose together. Understanding them makes everything else click.

## Schemas are the Source of Truth

Instead of writing types *and* migration files *and* Prisma schemas, you write **one** TypeBox object:

```typescript
import { Object, String, Number, Integer, Array, Optional } from "typebox";

const ProductSchema = Object({
  sku: String(),
  name: String(),
  price: Number(),
  stock: Integer(),
});
```

This single schema gives you:
- Runtime validation via TypeBox
- Full TypeScript types for inserts, updates, and queries
- Automatic SQLite table generation

No codegen step, no files to keep in sync.

## Sub-Tables

Arrays of objects inside a schema become **sub-tables** - separate SQLite tables with proper foreign keys and indexing:

```typescript
const OrderSchema = Object({
  id: String(),
  customerId: String(),
  lineItems: Array(
    Object({
      sku: String(),
      qty: Integer(),
      price: Number(),
    })
  ),
});
```

When you insert an order, foxdb automatically splits `lineItems` into a child table. When you `findById`, they come back joined. Zero boilerplate.

## Primitive Arrays

Arrays of strings, numbers, or booleans are stored as **JSON strings** in a single column:

```typescript
const UserSchema = Object({
  id: String(),
  tags: Array(String()), // stored as '["a", "b"]'
});
```

These are queryable using `arraySome`, `isEmpty`, or the high-performance `fastArraySome` operators.

## The `table()` Descriptor

`table()` turns a schema into a database table. You declare the primary key, indexes, timestamps, and sub-table configs:

```typescript
table(OrderSchema, (s) => ({
  primaryKey: s.id,
  indexes: [
    { columns: [s.customerId] },
  ],
  timestamps: true, // adds createdAt / updatedAt
  subTables: {
    lineItems: {
      indexes: [{ columns: [s.lineItems.sku] }],
    },
  },
}))
```

## Repositories

Every entry in `tables:` becomes a typed **Repository** on the ORM object:

```typescript
const orm = createORM({
  tables: { users: table(UserSchema, ...) },
});

orm.users.insert(...);
orm.users.findById(...);
orm.users.findMany(...);
orm.users.update(...);
orm.users.deleteById(...);
```

All methods are fully typed end-to-end.

## Relations

Define cross-table links with a fluent builder:

```typescript
const orm = createORM({
  tables: {
    orders: table(OrderSchema, (s) => ({ primaryKey: s.id })),
    products: table(ProductSchema, (s) => ({ primaryKey: s.sku })),
  },
  relations: (r) => [
    r.from("orders")
      .subTable("lineItems", "sku")
      .to("products", "sku", { as: "product" }),
  ],
});

const order = orm.orders.findById("ord-1");
for (const item of order.lineItems) {
  console.log(item.product.name); // resolved lazily or in batches
}
```

## Events

The event bus has **zero overhead** unless you subscribe. When you do, you get full type safety:

```typescript
orm._events.on("users", "insert", (e) => {
  console.log(`user ${e.data.id} inserted`);
});

orm._events.on("users", "write", (e) => {
  // catches insert, update, upsert
});
```

## Lifecycle Hooks

Hook into startup and shutdown for seeding, migrating, or cleanup:

```typescript
createORM({
  seed: (o) => { /* run after sync */ },
  onReady: (ctx) => { /* db is live */ },
  onShutdown: (ctx) => { /* before close */ },
  onExit: (ctx) => { /* after close */ },
});
```

## Error Handling

All errors are `ORMError` instances with rich context:

```typescript
try {
  orm.users.insert({ id: null, name: "oops" });
} catch (e) {
  if (e instanceof ORMError) {
    console.log(e.code);     // "VALIDATION_FAILED"
    console.log(e.trace);    // operation trace
    console.log(e.context);  // { table: "users", ... }
  }
}
```

Configure the global error policy to `throw`, `emit`, `emit-swallow`, or `crash`.

## Generated Columns

Define computed columns that are calculated from SQL expressions. These columns are automatically populated by SQLite and cannot be written to directly:

```typescript
import { Object, String, Number, Type } from "typebox";

const OrderSchema = Object({
  id: String(),
  amount: Number(),
});

const orm = createORM({
  tables: {
    orders: table(OrderSchema, (s) => ({
      primaryKey: s.id,
      generated: {
        doubleAmount: { expr: "amount * 2", type: Type.Number() },
      },
    })),
  },
});

// Insert only writes to writable columns
orm.orders.insert({ id: "o1", amount: 100 });

// Query returns the generated column
const order = orm.orders.findById("o1");
console.log(order.doubleAmount); // 200

// Generated columns are also queryable
const rows = orm.orders.findMany({
  where: { doubleAmount: { gte: 150 } },
});
```

Generated columns work with full type inference - the TypeBox type determines both the TypeScript type and the SQLite column type.
