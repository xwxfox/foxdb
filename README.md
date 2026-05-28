# foxdb ~ a typed sqlite orm for bun :3

> built on top of [typebox](https://github.com/sinclairzx81/typebox) schemas and `bun:sqlite`. fast, tiny, fully typed :3

foxdb gives you a repository-style orm where your database schema *is* your typescript types. no codegen, no decorators, no magic. just plain typebox objects that compile to sqlite tables and give you autocomplete everywhere ~


> Credit to [@deadlinecode](https://github.com/deadlinecode) for the original idea and base :3

## quick start

```bash
bun add @xwxfox/foxdb
```

```typescript
import { Object, String, Number, Integer } from "typebox";
import { createORM, table } from "@xwxfox/foxdb";

const UserSchema = Object({
  id: String(),
  name: String(),
  email: String(),
  age: Integer(),
});

const orm = createORM({
  tables: {
    users: table(UserSchema, (s) => ({
      primaryKey: s.id,
      indexes: [{ columns: [s.email] }],
    })),
  },
});

// insert
const user = orm.users.insert({
  id: "usr-1",
  name: "alice",
  email: "alice@example.com",
  age: 30,
});

// find
const found = orm.users.findById("usr-1");

// update
orm.users.update({ id: "usr-1", name: "alice smith" });

// query
const adults = orm.users.findMany({
  where: { age: { gte: 18 } },
  orderBy: { column: "name", direction: "ASC" },
});

// paginate
const page = orm.users.findPage({
  where: { age: { gte: 18 } },
  limit: 10,
  offset: 0,
});

orm._close();
```

## why foxdb

- **zero codegen** - your typebox schema *is* the source of truth. no `prisma generate`, no migration files to keep in sync :3
- **fully typed** - every query, insert, update, and relation is typed end-to-end. try passing the wrong column name and typescript will bonk you
- **tiny** - ~2kb overhead on top of `bun:sqlite`. no external query builder, no connection pool, no bloat
- **relations** - scalar relations (lazy) and sub-table relations (batch resolved) with a fluent builder
- **events** - listen to table events (`insert`, `update`, `read`, `write`, etc.) typed to your schema. zero overhead unless you subscribe ~
- **lifecycle hooks** - `onStart`, `onReady`, `onShutdown`, `onExit` for seeding, migrating, cleaning up
- **sub-tables** - arrays of objects are automatically split into separate sqlite tables with proper indexing

## core concepts

### schemas

use [typebox](https://github.com/sinclairzx81/typebox) to define your data shape. foxdb supports all scalar types (`String`, `Number`, `Integer`, `Boolean`, `Literal`) plus arrays of objects (sub-tables) and arrays of scalars (JSON strings).

```typescript
import { Object, String, Number, Integer, Array, Optional } from "typebox";

const LineItemSchema = Object({
  sku: String(),
  qty: Integer(),
  price: Number(),
});

const OrderSchema = Object({
  id: String(),
  customerId: String(),
  status: String(),
  total: Number(),
  tags: Array(String()),          // becomes a JSON string column ~
  lineItems: Array(LineItemSchema), // becomes a sub-table ~
});
```

### tables

the `table()` helper turns a schema into a table descriptor. you pick the primary key, add indexes, and optionally enable timestamps.

```typescript
table(OrderSchema, (s) => ({
  primaryKey: s.id,
  indexes: [
    { columns: [s.customerId] },
    { columns: [s.status] },
  ],
  timestamps: true, // adds createdAt / updatedAt
}))
```

### repositories

every table becomes a repository on the orm object. all crud methods are fully typed:

- `insert(data)` - insert a record
- `insertMany(records)` - batch insert in a transaction
- `findById(id)` - find by primary key
- `findMany(opts)` - query with where, orderBy, limit, offset
- `findPage(opts)` - findMany + total count for pagination
- `findOne(opts)` - findMany with limit 1
- `update(data)` - merge partial data (must include pk)
- `upsert(opts)` - insert or update on conflict
- `deleteById(id)` - delete by pk
- `deleteWhere(where)` - delete matching records
- `count(where?)` - count matching records
- `flush()` - truncate the table and sub-tables

### relations

define cross-table relations with a fluent builder:

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

// sub-table items now have a .product property
const order = orm.orders.findById("ord-1");
for (const item of order.lineItems) {
  console.log(item.product.name); // lazy or batch resolved :3
}
```

### events

listen to table or lifecycle events with full type safety:

```typescript
// table-specific fine-grained event
const off = orm._events.on("users", "insert", (e) => {
  console.log(`user ${e.data.id} inserted at ${e.timestamp}`);
});

// broad category - catches all writes (insert, update, upsert)
orm._events.on("users", "write", (e) => {
  console.log(`write op: ${e.operation}`);
});

// lifecycle events
orm._events.on("ready", (e) => {
  console.log("orm is ready ~");
});

// cleanup
off();
```

events have **zero overhead** unless you subscribe. the event bus only builds payloads when a listener exists.

### lifecycle hooks

hook into startup and shutdown to seed, migrate, or clean up:

```typescript
const orm = createORM({
  tables: { /* ... */ },

  seed: (o) => {
    o.products.insert({ sku: "WIDGET", name: "widget", price: 9.99 });
  },

  onReady: (ctx) => {
    console.log("tables:", ctx.tables.join(", "));
  },

  onShutdown: (ctx) => {
    ctx.orm.activity.insert({
      id: "shutdown",
      message: "shutting down",
      level: "info",
    });
  },

  rebuildOnLaunch: true,      // wipe db on every start
  unlinkDbFilesOnExit: true,  // delete .db files on close
});
```

### configuration

```typescript
createORM({
  path: "myapp.db",              // sqlite file path (default: ":memory:")
  cacheSize: -64000,             // sqlite cache size in pages
  busyTimeout: 5000,             // ms to wait for write locks
  synchronous: "NORMAL",         // pragma synchronous level
  rebuildOnLaunch: false,        // wipe and rebuild on start
  flushOnStart: ["logs"],        // truncate tables before seeding
  dropOnExit: ["temp"],          // drop tables before close
  autoMigrate: true,             // run migrations on startup
  migrations: { dir: "./migrations" },
  errorPolicy: "throw",          // "throw" | "emit" | "emit-swallow" | "crash"
  unlinkDbFilesOnExit: false,    // true | "onlyGraceful" | "any"
})
```

## error handling

foxdb uses `ORMError` with invisible trace context. every throw includes the operation name, table, sql, and parameters that led to the error:

```typescript
try {
  orm.users.insert({ id: null, name: "oops" });
} catch (e) {
  if (e instanceof ORMError) {
    console.log(e.code);      // "VALIDATION_FAILED"
    console.log(e.trace);     // [{ label: "repository.insert", time: ... }]
    console.log(e.context);   // { table: "users" }
  }
}
```

configure the error policy to crash, emit, swallow, or just throw.

## migrations

foxdb can auto-run migrations on startup. create migration files and point `migrations.dir` at them:

```typescript
// migrations/001-init.ts
import type { Migration } from "@xwxfox/foxdb";

export default {
  name: "init",
  date: "2024-01-15",
  up(db) {
    // raw sql via db.exec() if needed
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

## license

mit uwu
