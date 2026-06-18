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

// query (chain api)
const adults = orm.users
  .findMany()
  .greaterThanOrEqual("age", 18)
  .orderBy("name", "ASC")
  .exec();

// paginate
const page = orm.users
  .findPage()
  .greaterThanOrEqual("age", 18)
  .limit(10)
  .page(0)
  .exec();

// count
const total = orm.users.count().greaterThanOrEqual("age", 18).exec();

// aggregate
const stats = orm.users
  .aggregate()
  .avg("age")
  .groupBy("name")
  .exec();

orm._close();
```

## why foxdb

- **zero codegen** - your typebox schema *is* the source of truth. no `prisma generate`, no migration files to keep in sync :3
- **fully typed** - every query, insert, update, and relation is typed end-to-end. try passing the wrong column name and typescript will bonk you
- **chain query api** - `findMany().where({...}).orderBy(...).limit(10).exec()` with full type autocomplete
- **relations** - scalar relations (lazy) and sub-table relations (batch resolved) with a fluent builder
- **events** - listen to table events (`insert`, `update`, `read`, `write`, etc.) typed to your schema. zero overhead unless you subscribe ~
- **lifecycle hooks** - `onStart`, `onReady`, `onShutdown`, `onExit` for seeding, migrating, cleaning up
- **sub-tables** - arrays of objects are automatically split into separate sqlite tables with proper FK cascade and indexing
- **soft deletes** - configurable per-table soft delete column, auto-filtered from all queries
- **compression** - per-column gzip compression for large text columns
- **eviction** - automatic row cleanup with TTL or max-row limits

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
  tags: Array(String()),          // becomes a sub-table with _value column ~
  lineItems: Array(LineItemSchema), // becomes a sub-table ~
});
```

### tables

the `table()` helper turns a schema into a table descriptor. you pick the primary key, add indexes, and configure table options.

```typescript
table(OrderSchema, (s) => ({
  primaryKey: s.id,
  indexes: [
    { columns: [s.customerId] },
    { columns: [s.status] },
  ],
  timestamps: true,                      // adds createdAt / updatedAt
  softDelete: { column: "deletedAt" },   // soft delete support
  compression: {                         // gzip specific columns
    algorithm: "gzip",
    columns: [s.notes],
  },
  eviction: {                            // auto-cleanup old rows
    ttlColumn: "createdAt",
    ttlMs: 24 * 60 * 60 * 1000,         // 24 hours
    maxRows: 100000,
  },
}))
```

### repositories

every table becomes a repository on the orm object. all crud methods are fully typed.

**Writing:**
- `insert(data)` - insert a record
- `insertMany(records)` - batch insert in a transaction
- `update(data)` - merge partial data (must include pk)
- `updateWhere({ where, data })` - bulk update matching records
- `upsert({ data, conflictTarget })` - insert or update on conflict
- `upsertMany({ data, conflictTarget })` - bulk upsert
- `deleteById(id)` - delete by pk (fk cascade on sub-tables)
- `deleteWhere(where)` - delete matching records
- `flush()` - truncate table and sub-tables
- `drop()` - drop table entirely

**Reading (chain api):**
- `findMany().where({...}).orderBy(...).limit(10).exec()` - fluent query builder
- `findOne().equals("id", "x").exec()` - single record query
- `findPage().limit(10).page(0).exec()` - paginated query with total count
- `findCursorPage().orderBy(...).limit(25).exec()` - cursor-based pagination
- `count().greaterThan("age", 18).exec()` - count with optional filter
- `aggregate().avg("price").groupBy("category").exec()` - aggregate queries
- `O_iterate({ where, limit })` - lazy generator iteration

**Validation:**
- `parse(data)` - validate and return typed data without inserting
- `check(data)` - type guard, returns true if data matches schema

### chain query api

the chain api gives you fluent, type-safe query building:

```typescript
const results = orm.users
  .findMany()
  .equals("status", "active")
  .greaterThanOrEqual("age", 18)
  .orderBy("createdAt", "DESC")
  .limit(10)
  .select(["id", "name", "email"])
  .exec();

// array filters on scalar sub-tables
const tagged = orm.users
  .findMany()
  .arraySome("tags", "admin")
  .exec();

// nested sub-table filters
const withItem = orm.orders
  .findMany()
  .nested("lineItems", (li) => li.equals("sku", "WIDGET"))
  .exec();
```

### sub-table filtering

filter parent rows by sub-table content using dotted paths:

```typescript
// find orders containing a specific line item
orm.orders.O_findMany({
  where: { "lineItems.sku": { eq: "WIDGET" } }
})

// internally generates: EXISTS (SELECT 1 FROM orders__lineItems WHERE _owner_id = orders.id AND "sku" = ?)
```

sub-tables use `ON DELETE CASCADE` foreign keys - deleting a parent row auto-deletes all sub-rows.

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

// batch resolve all relations eagerly
const orders = orm.orders.findManyMaterialized({ limit: 50 });
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

### batch writing

for high-throughput insert streaming, use `createBatchWriter`:

```typescript
const writer = orm.events.createBatchWriter({
  maxBuffer: 1000,          // flush when 1000 rows buffered
  flushIntervalMs: 5000,    // or every 5 seconds
});

for (const event of eventStream) {
  writer.insert({ id: event.id, type: event.type, data: event.data });
}
writer.close(); // final flush
```

### configuration

```typescript
createORM({
  path: "myapp.db",              // sqlite file path (default: ":memory:")
  cacheSize: -64000,             // sqlite cache size in pages
  busyTimeout: 5000,             // ms to wait for write locks
  synchronous: "NORMAL",         // pragma synchronous level
  mmapSize: 268435456,           // 256 MB memory-mapped i/o
  autoVacuum: "incremental",     // reclaim free pages
  rebuildOnLaunch: false,        // wipe and rebuild on start
  flushOnStart: ["logs"],        // truncate tables before seeding
  dropOnExit: ["temp"],          // drop tables before close
  autoMigrate: true,             // run migrations on startup
  migrations: { dir: "./migrations" },
  errorPolicy: "throw",          // "throw" | "emit" | "emit-swallow" | "crash"
  unlinkDbFilesOnExit: false,    // true | "onlyGraceful" | "any"
  sync: "auto",                  // schema drift policy: "ignore" | "warn" | "error" | "auto"
  hooks: {
    onQuery: (meta) => {         // query metrics hook
      if (meta.durationMs > 100) console.warn("slow query", meta);
    },
  },
})
```

### sub-tables

arrays of objects are automatically split into child tables with:
- `_id` autoincrement primary key
- `_owner_id` foreign key with `ON DELETE CASCADE` back to parent
- `_index` ordering column
- Automatic indexes on `_owner_id` and TEXT columns
- Batch-hydrated on `include` for N+1 safety

arrays of scalars get a `_value` column with indexes for fast `arraySome`/`arrayNot` filtering.

### soft deletes

configure a soft delete column to keep deleted rows recoverable:

```typescript
table(Schema, (s) => ({
  primaryKey: s.id,
  softDelete: { column: "deletedAt" },
}))
```

all queries automatically exclude soft-deleted rows. pass `includeDeleted: true` to see them:

```typescript
orm.users.O_findMany({ where: { status: { eq: "active" } }, includeDeleted: true })
```

## error handling

foxdb uses `ORMError` with trace context. every throw includes the operation name, table, sql, and parameters that led to the error:

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

auto-run timestamped migration files on startup. each migration runs in a transaction:

```typescript
// ./migrations/001_add_notes.ts
import type { Migration } from "@xwxfox/foxdb";

export default {
  name: "add_notes",
  up(db) {
    db.exec(`ALTER TABLE users ADD COLUMN notes TEXT`);
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

tracked in `_foxdb_migrations` so each migration runs exactly once.

## generated columns

sqlite computed columns defined in your schema:

```typescript
import { Generated } from "@xwxfox/foxdb";

table(OrderSchema, (s) => ({
  primaryKey: s.id,
  generated: {
    totalWithTax: { expr: `"total" * 1.25`, type: Number() },
  },
}))
```

generated columns are read-only - they're computed automatically by sqlite and excluded from INSERT/UPDATE.

## debugging

foxdb has three feature flags for debugging:

```bash
# trace every operation with timing breakdowns
bun --feature DEBUG_TRACING run ./app.ts

# log how sql is built (query plans, where clause resolution, ddl decisions)
bun --feature DEBUG_SQL_BUILDING run ./app.ts

# emit all executed sql to ./foxdb-queries.sql with sections and params
bun --feature DEBUG_SQL_FILE run ./app.ts
```

## license

MIT