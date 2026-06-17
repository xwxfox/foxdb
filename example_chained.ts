/**
 * foxdb - comprehensive usage example
 *
 * Demonstrates:
 *   • Typed schemas, column refs, indexes, sub-tables
 *   • Relations (scalar + sub-table) with lazy & batch materialization
 *   • The event system - fine-grained and broad table events
 *   • Lifecycle hooks (start / ready / shutdown / exit)
 *   • Seed, rebuildOnLaunch, flushOnStart, unlinkDbFilesOnExit
 *   • Error tracing with ORMError + configurable errorPolicy
 *   • Transactions, upserts, pagination, and clean serialization
 */

import {
    Object, String, Number, Integer, Boolean, Array, Optional,
    type Static,
} from "typebox";
import { createORM, table } from "./src/index.ts";

// ─── 1. Schemas ───────────────────────────────────────────────────────────────

const InventorySchema = Object({
    sku: String(),
    name: String(),
    price: Number(),
    stock: Integer(),
    category: String(),
    active: Boolean(),
});
type Inventory = Static<typeof InventorySchema>;

const LineItemSchema = Object({
    itemNumber: String(),
    quantity: Integer(),
    unitPrice: Number(),
    discount: Optional(Number()),
});

const SaleSchema = Object({
    id: String(),
    customerId: String(),
    status: String(),
    total: Number(),
    createdAt: Integer(),
    lineItems: Array(LineItemSchema),
});
type Sale = Static<typeof SaleSchema>;

const ActivitySchema = Object({
    id: String(),
    message: String(),
    level: String(),
});

// ─── 2. Create ORM with ALL the new bells & whistles ──────────────────────────

const orm = createORM({
    path: "shop.db",

    // Schema
    tables: {
        inventory: table(InventorySchema, (s) => ({
            primaryKey: s.sku,
            indexes: [
                { columns: [s.category] },
                { columns: [s.active] },
            ],
        })),
        sales: table(SaleSchema, (s) => ({
            primaryKey: s.id,
            timestamps: true,
            indexes: [
                { columns: [s.customerId] },
                { columns: [s.status] },
            ],
        })),
        activity: table(ActivitySchema, (s) => ({
            primaryKey: s.id,
        })),
    },

    relations: (r) => [
        r.from("sales")
            .subTable("lineItems", "itemNumber")
            .to("inventory", "sku", { as: "inventory" }),
    ],

    // ─── Lifecycle & QoL ────────────────────────────────────────────────────────

    /** Wipe everything on every run so the demo is repeatable */
    rebuildOnLaunch: true,

    /** Flush only the logs table before we start (demo of per-table start flush) */
    flushOnStart: ["activity"],

    /** Seed function runs after sync but before ready */
    seed: (o) => {
        console.log("[seed] Seeding initial inventory...");
        o.inventory.insert({
            sku: "WIDGET-A",
            name: "Widget Alpha",
            price: 9.99,
            stock: 100,
            category: "widgets",
            active: true,
        });
        o.inventory.insert({
            sku: "GADGET-B",
            name: "Gadget Beta",
            price: 24.99,
            stock: 50,
            category: "gadgets",
            active: true,
        });
    },

    /** Startup hook - runs before validation / sync */
    onStart: (ctx) => {
        console.log("[lifecycle:onStart] Tables:", ctx.tables.join(", "));
    },

    /** Ready hook - DB is fully usable */
    onReady: (ctx) => {
        console.log("[lifecycle:onReady] Schema hash:", ctx.orm._meta.schemaHash?.slice(0, 8));
    },

    /** Shutdown hook - before DB closes */
    onShutdown: (ctx) => {
        console.log("[lifecycle:onShutdown] Persisting final state...");
        ctx.orm.activity.insert({ id: "shutdown", message: "ORM shutting down", level: "info" });
    },

    /** Exit hook - after DB is closed */
    onExit: (_ctx) => {
        console.log("[lifecycle:onExit] Goodbye!");
    },

    /** Clean up DB files on graceful close */
    unlinkDbFilesOnExit: true,
});


// ─── 3. Event System Demo ─────────────────────────────────────────────────────

console.log("\n─── Event System ───");

// Fine-grained: listen to every insert on inventory
const offInsert = orm._events.on("inventory", "insert", (e) => {
    console.log(`[event:inventory.insert] table=${e.table} op=${e.operation}`);
});

// Broad: listen to ALL writes (insert, update, upsert) on sales
const offWrite = orm._events.on("sales", "write", (e) => {
    console.log(`[event:sales.write] operation=${e.operation}`);
});

// Broad: listen to ALL reads on inventory
const offRead = orm._events.on("inventory", "read", (e) => {
    console.log(`[event:inventory.read] operation=${e.operation}`);
});

// ─── 4. CRUD + Sub-tables ─────────────────────────────────────────────────────

console.log("\n─── CRUD ───");

// Insert a sale with sub-table line items
const sale = orm.sales.insert({
    id: "SALE-001",
    customerId: "CUST-42",
    status: "paid",
    total: 44.97,
    createdAt: Date.now(),
    lineItems: [
        { itemNumber: "WIDGET-A", quantity: 3, unitPrice: 9.99 },
        { itemNumber: "GADGET-B", quantity: 1, unitPrice: 24.99, discount: 5 },
    ],
});
console.log("Inserted sale:", sale.id, "| createdAt:", sale.createdAt);

// Find by PK - sub-table hydrated automatically
const fetched = orm.sales.findById("SALE-001");
console.log("Fetched line items:", fetched?.lineItems.length);

// Typed WHERE + orderBy + pagination (chain API)
const paid = orm.sales
    .findMany()
    .equals("status", "paid")
    .orderBy("createdAt", "DESC")
    .exec();
console.log("Paid sales:", paid.length);

// Paginated find (chain API)
const page = orm.sales
    .findPage()
    .equals("customerId", "CUST-42")
    .limit(10)
    .offset(0)
    .exec();
console.log(`Page: ${page.data.length} of ${page.total}`);

// Old object-based API still works via O_ prefix
const paidLegacy = orm.sales.O_findMany({
    where: { status: { eq: "paid" } },
    orderBy: { column: "createdAt", direction: "DESC" },
});

// Upsert
orm.inventory.upsert({
    data: { sku: "WIDGET-A", name: "Widget Alpha v2", price: 11.99, stock: 95, category: "widgets", active: true },
    conflictTarget: "sku",
    update: ["name", "price", "stock"],
});
console.log("Upserted price:", orm.inventory.findById("WIDGET-A")?.price);

// ─── 5. Materialization ───────────────────────────────────────────────────────

console.log("\n─── Materialization ───");

const saleForMat = orm.sales.findById("SALE-001")!;
const mat = saleForMat.materialize();
for (const li of mat.lineItems) {
    console.log(` - ${li.itemNumber} → resolved: ${li.inventory?.name ?? "NOT FOUND"}`);
}

// Batch materialize (N+1 safe)
const all = orm.sales.findManyMaterialized();
console.log("Batch materialized", all.length, "sales");

// ─── 6. Serialization stays clean ─────────────────────────────────────────────

console.log("\n─── Serialization ───");
console.log("JSON has no .materialize or .related keys:");
console.log(JSON.stringify(saleForMat, null, 2).slice(0, 200) + "...");

// ─── 7. Transactions ──────────────────────────────────────────────────────────

console.log("\n─── Transaction ───");
orm._transaction(() => {
    orm.inventory.insert({ sku: "TX-1", name: "TxItem", price: 1, stock: 1, category: "tx", active: true });
    orm.sales.insert({
        id: "SALE-002", customerId: "TX", status: "pending", total: 1, createdAt: Date.now(), lineItems: [],
    });
});
console.log("Transaction committed - sales count:", orm.sales.count().exec());

// ─── 8. Meta Access ───────────────────────────────────────────────────────────

console.log("\n─── Meta ───");
console.log("Schema hash:", orm._meta.schemaHash?.slice(0, 16) + "...");
console.log("Tables:", orm._meta.tables?.join(", "));
console.log("Version:", orm._meta.version);

// ─── 9. Flush ─────────────────────────────────────────────────────────────────

console.log("\n─── Flush ───");
console.log("Logs before flush:", orm.activity.count().exec());
orm.activity.insert({ id: "L1", message: "hello", level: "debug" });
console.log("Logs after insert:", orm.activity.count().exec());
orm._flush(); // flushes ALL tables
console.log("Logs after orm._flush():", orm.activity.count().exec());

// ─── 10. Remove event listeners ───────────────────────────────────────────────

offInsert();
offWrite();
offRead();
console.log("\nEvent listeners removed.");

// ─── 11. Cleanup ──────────────────────────────────────────────────────────────

console.log("\n─── Closing ───");
orm._close();
console.log("Done - DB files unlinked because unlinkDbFilesOnExit: true");

orm._events.on("inventory", "write", (event) => {
    console.log(`[event:inventory.write] operation=${event.operation}`);
});