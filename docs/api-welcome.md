# API Reference

This page is the human-readable API companion to the auto-generated TypeDoc output.
If you want type-level precision, browse the categories in the sidebar - but if you
want to know *how* to do something, start here.

## The ORM Object

`createORM()` returns the **foxdb** object. Every key you defined in `tables:`
becomes a fully typed `Repository`:

```ts
const orm = createORM({
  tables: {
    users: table(UserSchema, (s) => ({ primaryKey: s.id })),
    posts: table(PostSchema, (s) => ({ primaryKey: s.id })),
  },
});

// These are Repositories - every method is typed to the schema
orm.users.insert({ id: "u1", name: "alice" });
orm.posts.findById("p1");
```

The framework API lives on underscore-prefixed properties:

| Property | Purpose |
|----------|---------|
| `orm._transaction(fn)` | Run a block inside a SQLite transaction |
| `orm._close()` | Close the database |
| `orm._events` | Subscribe to table / lifecycle events |
| `orm._meta` | Read schema hash, table list, version |
| `orm._migrate()` | Run pending migrations |

---

## Repositories

Repositories are where you spend 95% of your time. They live at `orm.<tableName>`
and expose the methods below.

### Reading Data

#### `findById(id)`

Find a single record by its primary key.

```ts
const user = orm.users.findById("u1");
// user → { id: "u1", name: "alice", ... } | null
```

#### `findMany(options?)`

Query with `where`, `orderBy`, `limit`, and `offset`. The most versatile read method.

```ts
const adults = orm.users.findMany({
  where: { age: { gte: 18 } },
  orderBy: { column: "name", direction: "ASC" },
  limit: 10,
  offset: 0,
});

// Multiple orderBy clauses
const sorted = orm.users.findMany({
  orderBy: [
    { column: "status", direction: "DESC" },
    { column: "createdAt", direction: "ASC" },
  ],
});

// Include sub-tables
const orders = orm.orders.findMany({ include: ["lineItems"] });
```

#### `findPage(options?)`

Same as `findMany` but returns `{ data, total, limit, offset }` for pagination UIs.

```ts
const page = orm.users.findPage({
  where: { status: { eq: "active" } },
  limit: 10,
  offset: 0,
});

console.log(page.total); // total matching rows
console.log(page.data);  // the actual records
```

#### `findOne(options?)`

`findMany` with `limit: 1`, but returns the entity directly (or `null`).

```ts
const admin = orm.users.findOne({
  where: { role: { eq: "admin" } },
});
```

#### `count(where?)`

Count matching records.

```ts
const total = orm.users.count();
const adults = orm.users.count({ age: { gte: 18 } });
```

---

### Writing Data

#### `insert(data)`

Insert a single record. Validates against the schema, adds timestamps if enabled,
and returns the inserted entity.

```ts
const user = orm.users.insert({
  id: "u1",
  name: "alice",
  email: "alice@example.com",
});
```

#### `insertMany(records)`

Batch insert inside a single transaction.

```ts
orm.users.insertMany([
  { id: "u1", name: "alice", email: "a@x.com" },
  { id: "u2", name: "bob", email: "b@x.com" },
]);
```

#### `update(data)`

Partial update - must include the primary key. Returns the updated entity or `null`.

```ts
orm.users.update({ id: "u1", name: "alice smith" });
```

#### `upsert(options)`

Insert or update on conflict.

```ts
orm.users.upsert({
  data: { id: "u1", name: "alice", email: "new@x.com" },
  conflictTarget: "id",
});
```

#### `deleteById(id)`

Delete by primary key. Returns `true` if a row was removed.

```ts
orm.users.deleteById("u1");
```

#### `deleteWhere(where)`

Delete all rows matching the filter. Returns the number of rows deleted.

```ts
orm.users.deleteWhere({ status: { eq: "banned" } });
```

---

### Where Filters

`where` accepts an object where each key is a column and each value is a filter:

```ts
// Equality
{ name: { eq: "alice" } }

// String filters
{ name: { like: "%alice%" } }
{ email: { in: ["a@x.com", "b@x.com"] } }
{ email: { notIn: ["spam@x.com"] } }

// Number / integer filters
{ age: { gt: 18 } }
{ age: { gte: 18, lte: 65 } }
{ age: { between: [18, 65] } }

// Null checks
{ deletedAt: { isNull: true } }
{ deletedAt: { isNotNull: true } }
```

---

### Raw SQL

When the ORM doesn't support what you need, `raw()` is your escape hatch:

```ts
const rows = orm.users.raw<{ name: string; total: number }>(
  'SELECT name, COUNT(*) as total FROM users GROUP BY name'
);
```

---

## Events

The event bus has **zero overhead** unless you subscribe.

```ts
// Table-specific fine-grained event
const off = orm._events.on("users", "insert", (e) => {
  console.log(`user ${e.data.id} inserted`);
});

// Broad category - catches all writes (insert, update, upsert)
orm._events.on("users", "write", (e) => {
  console.log(`write op: ${e.operation}`);
});

// Lifecycle events
orm._events.on("ready", (e) => {
  console.log("db is ready");
});

// Cleanup
off();
```

---

## Relations

Define cross-table links with a fluent builder:

```ts
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

---

## Migrations

Auto-run migrations on startup:

```ts
createORM({
  tables: { /* ... */ },
  migrations: { dir: "./migrations" },
  autoMigrate: true,
});
```

Migration file format:

```ts
// migrations/001-init.ts
import type { Migration } from "@xwxfox/foxdb";

export default {
  name: "init",
  date: "2024-01-15",
  up(db) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)");
  },
} satisfies Migration;
```

---

## Error Handling

All errors are `ORMError` instances with rich context:

```ts
try {
  orm.users.insert({ id: null, name: "oops" });
} catch (e) {
  if (e instanceof ORMError) {
    console.log(e.code);     // "VALIDATION_FAILED"
    console.log(e.trace);    // [{ label: "repository.insert", time: ... }]
    console.log(e.context);  // { table: "users" }
  }
}
```

Configure the global error policy:

```ts
createORM({
  errorPolicy: "throw",   // default
  // errorPolicy: "emit",        // emit event instead of throwing
  // errorPolicy: "emit-swallow", // emit and swallow
  // errorPolicy: "crash",        // crash the process
});
```

---

## TypeDoc Categories

The auto-generated API docs are organized into categories so you can find what you need:

| Category | What's inside |
|----------|---------------|
| **Setup** | `createORM`, `foxdb`, `CreateORMOptions` |
| **Repositories** | `Repository` class and all CRUD methods |
| **Schema** | `table`, `TableDescriptor`, `ColumnRef`, `IndexDefinition`, `GeneratedColumnConfig` |
| **Query Types** | `FindOptions`, `WhereClause`, `PageResult`, `Entity` |
| **Relations** | `RelationBuilder`, `TypedRelation`, `Materialized` |
| **Events** | `EventBus`, `ORMEvents`, `TableEventPayload` |
| **Lifecycle** | `LifecycleManager`, hooks |
| **Migration** | `migrate`, `Migration`, `SchemaDiff` |
| **Errors** | `ORMError`, `ErrorPolicy` |
| **Database** | `BunDatabase`, `MetaStore` |
| **Advanced** | Introspection, raw SQL helpers |
