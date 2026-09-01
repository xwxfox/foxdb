/**
 * Quick async vs sync read benchmark (target: ~25s).
 *
 * Seeds a file DB, runs sync + async read ops, prints comparison.
 *
 * Usage: bun run ./benchmarks/quick-read-bench.ts
 */
import { createORM, table } from "../src/index.ts";
import { SaleSchema } from "../tests/real-world-types/index.ts";
import type { Sale } from "../tests/real-world-types/index.ts";

// --- Configuration -----------------------------------------------------------

const DB_PATH = "./bench-quick.db";
const SEED_COUNT = 10_000;
const WARMUP_COUNT = 500;
const POOL_SIZE = 4;

// light batch = fast operations (pure PK lookups, simple counts)
const LIGHT = 5_000;
// heavy batch = operations that scan / aggregate
const HEAVY = 300;

// --- Schema ------------------------------------------------------------------

function makeSeedORM() {
  return createORM({
    path: DB_PATH,
    rebuildOnLaunch: true,
    tables: {
      sales: table(SaleSchema, (s) => ({
        primaryKey: s.OrderNumber,
        indexes: [{ columns: [s.Status__Group] }],
      })),
    },
  });
}

function makeORM(asyncPool: boolean) {
  return createORM({
    path: DB_PATH,
    asyncReaderPool: asyncPool ? POOL_SIZE : undefined,
    tables: {
      sales: table(SaleSchema, (s) => ({
        primaryKey: s.OrderNumber,
        indexes: [{ columns: [s.Status__Group] }],
      })),
    },
  });
}

function makeSale(n: number): Sale {
  return {
    OrderNumber: n,
    OrderTransaction: 1000 + n,
    InvoiceNumbers: [1001 + n, 1002 + n],
    LastChanged: "2024-01-15T10:30:00Z",
    CreatedDate: "2024-01-10T08:00:00Z",
    DocumentDate: "2024-01-12", DeliveryDate: "2024-01-20T00:00:00Z",
    Account: 42 + (n % 100),
    InvoiceAccount: 42 + (n % 100),
    SearchName: `Customer ${n}`,
    CustomerInfo: {
      CustomerName: `Customer ${n}`,
      CustomerAddress: {
        AddressField1: `${n} Main St`, AddressField2: "Suite 100",
        AddressField3: null, State: null, ZipCity: "Copenhagen 1000",
        Country: "DK", Attention: "John Doe",
        DeliveryAddress: {
          AddressField1: "456 Warehouse Rd", AddressField2: null,
          AddressField3: null, AddressField4: null, AddressField5: null,
          Country: "DK", Attention: "Receiving", Phone: "+45 12345678",
          NoteEmail: "receive@acme.dk",
        },
      },
      CustomerContact: {
        Phone: "+45 87654321", Fax: null, Email: `customer${n}@test.dk`,
      },
    },
    Pricing: {
      TotalMargin: 500 + n, TotalTurnover: 2500 + n,
      TotalCostPrice: 2000 + n, TotalMarginDKK: 500 + n,
      TotalTurnoverDKK: 2500 + n, TotalCostPriceDKK: 2000 + n,
      Invoices: [{
        RowNumber: 1, LastChanged: "2024-01-15T10:30:00Z",
        BudgetCode: "SALES", Account: 42, Department: null,
        Date: "2024-01-15", InvoiceNumber: 1001 + n, Voucher: "V001",
        Text: `Invoice ${n}`, TransactionType: 1,
        AmountMST: 2500 + n, AmountCur: 2500 + n, Currency: "DKK",
        Vat: "25", VatAmount: 500, Approved: true, ApprovedBy: "ADMIN",
        CashDiscountAmount: 0, CashDiscountDate: null,
        DueDate: "2024-02-15", Open: false, ExchangeRate: 100,
        Reserved2: null, Reserved3: null, PostedDiffAmount: 0,
        RefRecId: null, Transaction: 1, ReminderCode: null,
        CashDiscount: null, RemindedDate: null, ExchangeRateTri: 100,
        PaymentId: "PAY001", Centre: null, Purpose: null,
        PaymentMode: "BANK", ReminderSent: false,
      }],
      VATNumber: "DK12345678", VATNumberType: "SE", Currency: "DKK",
      EstimatedOrderExchangeRate: 100, PaymentTerms: "NET30",
    },
    Shipping: {
      DeliveryTerms: "DDP", TrackingNumber: `TRACK${n}`, TrackingType: 5,
      ShippingService: "PostDK", ShippingAccountType: "OWN",
      FreightDimensions: { Weight: 10.5, Length: 50, Height: 30, Width: 40 },
    },
    Reference: {
      YourRef: `PO-${n}`, OurRef: `REF-${n}`,
      Purpose: "Standard order", SalesChannel: "WEB",
    },
    Status: {
      Blocked: false, OrderPhase: 2, IsSalesPhase: 1,
      Group: ["PNP", "TECH", "RMA"][n % 3],
      ExtendedDocumentsLink: null, OrderStatus: "ACTIVE",
    },
    HandledBy: { SalesRep: "ABC", Bearer: null, PickedBy: null, TestedBy: null, PackedBy: null, BookedBy: null },
    Testing: { TestHours: null, TestMinutes: null },
    Logs: [
      { raw: "Order created", timestamp: "2024-01-10T08:00:00Z", type: "ORDER_CREATED", metadata: [], metatags: [] },
    ],
    SalesLineItems: [{
      OrderNumber: n, LineNumber: 1, ItemNumber: `WID-${n}`,
      ItemName: `Widget ${n}`, Location: "WH-A1", ManufacturerGroup: "PNP",
      Quantity: 10, Discount: 0, Price: 100, PriceDKK: 100, PriceAmount: 1000,
      PriceAmountDKK: 1000, CostPrice: 80, CostPriceAmount: 800, Margin: 200,
      DeliverNow: 10, CreatedDate: "2024-01-10T08:00:00Z",
      DeliveryDate: "2024-01-20T00:00:00Z", SerialNumber: null, Delivered: 0,
      LastChanged: "2024-01-15T10:30:00Z",
    }, {
      OrderNumber: n, LineNumber: 2, ItemNumber: `GAD-${n}`,
      ItemName: `Gadget ${n}`, Location: "WH-B2", ManufacturerGroup: "TECH",
      Quantity: 5, Discount: 10, Price: 300, PriceDKK: 300, PriceAmount: 1500,
      PriceAmountDKK: 1500, CostPrice: 240, CostPriceAmount: 1200, Margin: 300,
      DeliverNow: 5, CreatedDate: "2024-01-10T08:00:00Z",
      DeliveryDate: "2024-01-20T00:00:00Z", SerialNumber: null, Delivered: 0,
      LastChanged: "2024-01-15T10:30:00Z",
    }],
  } as Sale;
}

// --- Helpers -----------------------------------------------------------------

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

interface BenchResult {
  ops: number;
  wallMs: number;
  cpuMs: number;
  meanUs: number;
  p50Us: number;
  p90Us: number;
  p99Us: number;
  minUs: number;
  maxUs: number;
  rssMB: number;
}

function runBench(opCount: number, run: (i: number) => void): BenchResult {
  Bun.gc(true);
  const latencies = new Float64Array(opCount);
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  for (let i = 0; i < opCount; i++) {
    const t0 = performance.now();
    run(i);
    latencies[i] = (performance.now() - t0) * 1000;
  }
  const wallEnd = performance.now();
  const cpuDelta = process.cpuUsage(cpuStart);
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const u = process.memoryUsage();
  return {
    ops: opCount,
    wallMs: wallEnd - wallStart,
    cpuMs: (cpuDelta.user + cpuDelta.system) / 1000,
    meanUs: sum / opCount,
    p50Us: sorted[Math.floor(opCount * 0.5)]!,
    p90Us: sorted[Math.floor(opCount * 0.9)]!,
    p99Us: sorted[Math.floor(opCount * 0.99)]!,
    minUs: sorted[0]!,
    maxUs: sorted[opCount - 1]!,
    rssMB: Math.round(u.rss / 1024 / 1024 * 100) / 100,
  };
}

async function runAsyncBench(opCount: number, run: (i: number) => Promise<void>): Promise<BenchResult> {
  Bun.gc(true);
  const latencies = new Float64Array(opCount);
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  for (let i = 0; i < opCount; i++) {
    const t0 = performance.now();
    await run(i);
    latencies[i] = (performance.now() - t0) * 1000;
  }
  const wallEnd = performance.now();
  const cpuDelta = process.cpuUsage(cpuStart);
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const u = process.memoryUsage();
  return {
    ops: opCount,
    wallMs: wallEnd - wallStart,
    cpuMs: (cpuDelta.user + cpuDelta.system) / 1000,
    meanUs: sum / opCount,
    p50Us: sorted[Math.floor(opCount * 0.5)]!,
    p90Us: sorted[Math.floor(opCount * 0.9)]!,
    p99Us: sorted[Math.floor(opCount * 0.99)]!,
    minUs: sorted[0]!,
    maxUs: sorted[opCount - 1]!,
    rssMB: Math.round(u.rss / 1024 / 1024 * 100) / 100,
  };
}

function printLine(prefix: string, r: BenchResult): void {
  const opsSec = fmt(r.ops / (r.wallMs / 1000));
  console.log(
    `  ${prefix.padEnd(26)} ` +
    `ops/s: ${opsSec.padStart(9)}  ` +
    `wall: ${fmt(r.wallMs).padStart(7)}ms  ` +
    `mean: ${fmt(r.meanUs).padStart(7)}us  ` +
    `p50: ${fmt(r.p50Us).padStart(7)}us  ` +
    `p90: ${fmt(r.p90Us).padStart(7)}us  ` +
    `p99: ${fmt(r.p99Us).padStart(7)}us  ` +
    `rss: ${fmt(r.rssMB).padStart(7)}MB`
  );
}

// --- Seed --------------------------------------------------------------------

console.log("=".repeat(94));
console.log("  QUICK ASYNC vs SYNC READ BENCHMARK");
console.log("=".repeat(94));
console.log(`\nSeeding ${SEED_COUNT} rows into ${DB_PATH} ...`);

{
  const orm = makeSeedORM();
  const batchSize = 1000;
  for (let start = 0; start < SEED_COUNT; start += batchSize) {
    const end = Math.min(start + batchSize, SEED_COUNT);
    const batch: Sale[] = [];
    for (let i = start; i < end; i++) batch.push(makeSale(i));
    orm.sales.insertMany(batch);
  }
  orm._close();
  console.log(`  Seeded ${SEED_COUNT} rows.`);
}

// --- Benchmarks --------------------------------------------------------------

interface BenchDef {
  name: string;
  count: number; // light (LIGHT) or heavy (HEAVY)
}

const BENCHES: BenchDef[] = [
  { name: "findById", count: LIGHT },
  { name: "findMany (no filter)", count: HEAVY },
  { name: "findMany (filter eq)", count: HEAVY },
  { name: "findMany (flattened)", count: HEAVY },
  { name: "findOne", count: LIGHT },
  { name: "findPage (limit 50)", count: HEAVY },
  { name: "count (no filter)", count: LIGHT },
  { name: "count (filtered)", count: HEAVY },
  { name: "aggregate (sum)", count: HEAVY },
];

type BenchEntry = { name: string; count: number; sync: BenchResult; async: BenchResult };

const entries: BenchEntry[] = [];

function syncOrmRun(orm: ReturnType<typeof makeORM>) {
  return {
    runSync: {
      findById: (i: number) => { orm.sales.findById(i % SEED_COUNT); },
      "findMany (no filter)": () => { orm.sales.O_findMany({ limit: 100 }); },
      "findMany (filter eq)": () => { orm.sales.O_findMany({ where: { Account: { eq: 42 } }, limit: 100 }); },
      "findMany (flattened)": () => { orm.sales.O_findMany({ where: { "Status.Group": { eq: "PNP" } }, limit: 100 }); },
      "findOne": (i: number) => { orm.sales.O_findOne({ where: { Account: { eq: 42 + (i % 100) } } }); },
      "findPage (limit 50)": () => { orm.sales.O_findPage({ limit: 50, offset: 0 }); },
      "count (no filter)": () => { orm.sales.O_count(); },
      "count (filtered)": () => { orm.sales.O_count({ Account: { eq: 42 } }); },
      "aggregate (sum)": () => { orm.sales.O_aggregate({ aggregations: { total: { sum: "Account" } } }); },
    },
    async runAsync() {
      return {
        "findById": async (i: number) => { await orm.sales.findByIdAsync(i % SEED_COUNT); },
        "findMany (no filter)": async () => { await orm.sales.O_findManyAsync({ limit: 100 }); },
        "findMany (filter eq)": async () => { await orm.sales.O_findManyAsync({ where: { Account: { eq: 42 } }, limit: 100 }); },
        "findMany (flattened)": async () => { await orm.sales.O_findManyAsync({ where: { "Status.Group": { eq: "PNP" } }, limit: 100 }); },
        "findOne": async (i: number) => { await orm.sales.O_findOneAsync({ where: { Account: { eq: 42 + (i % 100) } } }); },
        "findPage (limit 50)": async () => { await orm.sales.O_findPageAsync({ limit: 50, offset: 0 }); },
        "count (no filter)": async () => { await orm.sales.O_countAsync(); },
        "count (filtered)": async () => { await orm.sales.O_countAsync({ Account: { eq: 42 } }); },
        "aggregate (sum)": async () => { await orm.sales.O_aggregateAsync({ aggregations: { total: { sum: "Account" } } }); },
      };
    },
  };
}

// Sync
console.log(`\n--- SYNC (no pool) ---`);
{
  const orm = makeORM(false);
  for (let i = 0; i < WARMUP_COUNT; i++) orm.sales.findById(i % SEED_COUNT);

  const fns = syncOrmRun(orm).runSync;
  for (const { name, count } of BENCHES) {
    const r = runBench(count, fns[name as keyof typeof fns] as (i: number) => void);
    printLine(name, r);
    entries.push({ name, count, sync: r, async: null! });
  }
  orm._close();
}

// Async
console.log(`\n--- ASYNC (pool=${POOL_SIZE}) ---`);
{
  const orm = makeORM(true);
  for (let i = 0; i < WARMUP_COUNT; i++) await orm.sales.findByIdAsync(i % SEED_COUNT);

  const fns = await syncOrmRun(orm).runAsync();
  for (const { name, count } of BENCHES) {
    const r = await runAsyncBench(count, fns[name as keyof typeof fns] as (i: number) => Promise<void>);
    printLine(name, r);
    const entry = entries.find(e => e.name === name);
    if (entry) entry.async = r;
  }
  orm._close();
}

// Concurrent async throughput
console.log("\n--- Concurrent async (20 parallel, pool=" + POOL_SIZE + ") ---");
{
  const orm = makeORM(true);
  const CONCURRENT = 20;
  const BATCHES = 200;
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  let totalOps = 0;
  for (let b = 0; b < BATCHES; b++) {
    const batch: Promise<unknown>[] = [];
    for (let j = 0; j < CONCURRENT; j++) batch.push(orm.sales.O_findManyAsync({ limit: 100 }));
    await Promise.all(batch);
    totalOps += CONCURRENT;
  }
  const wallMs = performance.now() - wallStart;
  const cpuDelta = process.cpuUsage(cpuStart);
  const opsSec = totalOps / (wallMs / 1000);
  console.log(`  ${totalOps} reads in ${fmt(wallMs)}ms = ${fmt(opsSec)} ops/sec`);
  console.log(`  cpu=${fmt((cpuDelta.user + cpuDelta.system) / 1000)}ms  (${CONCURRENT} parallel × ${BATCHES} batches)`);
  orm._close();
}

// --- Summary ----------------------------------------------------------------

console.log("\n" + "=".repeat(94));
console.log("  COMPARISON");
console.log("=".repeat(94));
console.log(`\n  ${"Benchmark".padEnd(26)} ${"sync mean".padStart(9)} ${"async mean".padStart(9)} ${"sync ops/s".padStart(11)} ${"async ops/s".padStart(11)}  spdup`);
console.log("  " + "-".repeat(72));

for (const { name, sync, async } of entries) {
  const ratio = sync.meanUs / async.meanUs;
  const arrow = ratio >= 1.05 ? "▲" : ratio <= 0.95 ? "▼" : "-";
  console.log(
    `  ${name.padEnd(26)} ` +
    `${fmt(sync.meanUs).padStart(8)}us ` +
    `${fmt(async.meanUs).padStart(8)}us ` +
    `${fmt(sync.ops / (sync.wallMs / 1000)).padStart(10)} ` +
    `${fmt(async.ops / (async.wallMs / 1000)).padStart(10)} ` +
    `  ${fmt(ratio)}x${arrow}`
  );
}

console.log(`\n  Seed: ${SEED_COUNT} rows  |  Pool: ${POOL_SIZE} workers`);

// Cleanup
try {
  const { existsSync, unlinkSync } = await import("node:fs");
  for (const p of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(p)) unlinkSync(p);
} catch { /* ignore */ }

console.log("\nDone.");
