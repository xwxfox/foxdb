/**
 * Async reader pool vs sync reader benchmark.
 *
 * 1. Seeds a file DB with N rows (once)
 * 2. Opens a sync ORM (no pool), runs all sync read benchmarks
 * 3. Opens an async ORM (with pool), runs all async read benchmarks
 * 4. Prints comparison table
 *
 * Usage: bun run ./benchmarks/async-vs-sync-read-bench.ts
 */
import { createORM, table } from "../src/index.ts";
import { SaleSchema } from "../tests/real-world-types/index.ts";
import type { Sale } from "../tests/real-world-types/index.ts";

// --- Configuration -----------------------------------------------------------

const DB_PATH = "./bench-async-vs-sync.db";
const SEED_COUNT = 50_000;
const WARMUP_COUNT = 2_000;
const MEASURE_COUNT = 10_000;
const POOL_SIZE = 4;

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
    DocumentDate: "2024-01-12",
    DeliveryDate: "2024-01-20T00:00:00Z",
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
    HandledBy: {
      SalesRep: "ABC", Bearer: null, PickedBy: null, TestedBy: null,
      PackedBy: null, BookedBy: null,
    },
    Testing: { TestHours: null, TestMinutes: null },
    Logs: [
      {
        raw: "Order created", timestamp: "2024-01-10T08:00:00Z",
        type: "ORDER_CREATED", metadata: [], metatags: []
      },
    ],
    SalesLineItems: [
      {
        OrderNumber: n, LineNumber: 1, ItemNumber: `WID-${n}`,
        ItemName: `Widget ${n}`, Location: "WH-A1",
        ManufacturerGroup: "PNP", Quantity: 10, Discount: 0,
        Price: 100, PriceDKK: 100, PriceAmount: 1000,
        PriceAmountDKK: 1000, CostPrice: 80, CostPriceAmount: 800,
        Margin: 200, DeliverNow: 10,
        CreatedDate: "2024-01-10T08:00:00Z",
        DeliveryDate: "2024-01-20T00:00:00Z",
        SerialNumber: null, Delivered: 0,
        LastChanged: "2024-01-15T10:30:00Z",
      },
      {
        OrderNumber: n, LineNumber: 2, ItemNumber: `GAD-${n}`,
        ItemName: `Gadget ${n}`, Location: "WH-B2",
        ManufacturerGroup: "TECH", Quantity: 5, Discount: 10,
        Price: 300, PriceDKK: 300, PriceAmount: 1500,
        PriceAmountDKK: 1500, CostPrice: 240, CostPriceAmount: 1200,
        Margin: 300, DeliverNow: 5,
        CreatedDate: "2024-01-10T08:00:00Z",
        DeliveryDate: "2024-01-20T00:00:00Z",
        SerialNumber: null, Delivered: 0,
        LastChanged: "2024-01-15T10:30:00Z",
      },
    ],
  } as Sale;
}

// --- Helpers -----------------------------------------------------------------

function mem() {
  const u = process.memoryUsage();
  return { rssMB: Math.round(u.rss / 1024 / 1024 * 100) / 100, heapMB: Math.round(u.heapUsed / 1024 / 1024 * 100) / 100 };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

interface BenchResult {
  label: string;
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

function runBench(label: string, opCount: number, run: (i: number) => void): BenchResult {
  Bun.gc(true);
  const m0 = mem();
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
  const m1 = mem();

  return {
    label, ops: opCount,
    wallMs: wallEnd - wallStart,
    cpuMs: (cpuDelta.user + cpuDelta.system) / 1000,
    meanUs: sum / opCount,
    p50Us: sorted[Math.floor(opCount * 0.5)]!,
    p90Us: sorted[Math.floor(opCount * 0.9)]!,
    p99Us: sorted[Math.floor(opCount * 0.99)]!,
    minUs: sorted[0]!,
    maxUs: sorted[opCount - 1]!,
    rssMB: m1.rssMB,
  };
}

async function runAsyncBench(label: string, opCount: number, run: (i: number) => Promise<void>): Promise<BenchResult> {
  Bun.gc(true);
  const m0 = mem();
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
  const m1 = mem();

  return {
    label, ops: opCount,
    wallMs: wallEnd - wallStart,
    cpuMs: (cpuDelta.user + cpuDelta.system) / 1000,
    meanUs: sum / opCount,
    p50Us: sorted[Math.floor(opCount * 0.5)]!,
    p90Us: sorted[Math.floor(opCount * 0.9)]!,
    p99Us: sorted[Math.floor(opCount * 0.99)]!,
    minUs: sorted[0]!,
    maxUs: sorted[opCount - 1]!,
    rssMB: m1.rssMB,
  };
}

function printLine(label: string, r: BenchResult): void {
  const opsSec = fmt(r.ops / (r.wallMs / 1000));
  console.log(
    `  ${label.padEnd(30)} ` +
    `ops/s: ${opsSec.padStart(10)}  ` +
    `wall: ${fmt(r.wallMs).padStart(8)}ms  ` +
    `cpu: ${fmt(r.cpuMs).padStart(8)}ms  ` +
    `mean: ${fmt(r.meanUs).padStart(7)}us  ` +
    `p50: ${fmt(r.p50Us).padStart(7)}us  ` +
    `p90: ${fmt(r.p90Us).padStart(7)}us  ` +
    `p99: ${fmt(r.p99Us).padStart(7)}us  ` +
    `min: ${fmt(r.minUs).padStart(6)}us  ` +
    `max: ${fmt(r.maxUs).padStart(8)}us  ` +
    `rss: ${fmt(r.rssMB).padStart(7)}MB`
  );
}

// --- Seed phase --------------------------------------------------------------

console.log("=".repeat(94));
console.log("  ASYNC READER POOL vs SYNC - READ BENCHMARK");
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

// --- Sync benchmarks ---------------------------------------------------------

console.log(`\n--- SYNC (no pool) ---`);
const syncOrm = makeORM(false);

// Warmup
for (let i = 0; i < WARMUP_COUNT; i++) syncOrm.sales.findById(i % SEED_COUNT);

const syncResults: Array<{ name: string; r: BenchResult }> = [];

syncResults.push({ name: "findById", r: runBench("findById", MEASURE_COUNT, (i) => { syncOrm.sales.findById(i % SEED_COUNT); }) });
syncResults.push({ name: "findMany (no filter)", r: runBench("findMany (no filter)", 1000, () => { syncOrm.sales.O_findMany({ limit: 100 }); }) });
syncResults.push({ name: "findMany (filter eq)", r: runBench("findMany (filter eq)", 1000, () => { syncOrm.sales.O_findMany({ where: { Account: { eq: 42 } }, limit: 100 }); }) });
syncResults.push({ name: "findMany (flattened)", r: runBench("findMany (flattened)", 1000, () => { syncOrm.sales.O_findMany({ where: { "Status.Group": { eq: "PNP" } }, limit: 100 }); }) });
syncResults.push({ name: "findOne", r: runBench("findOne", 1000, (i) => { syncOrm.sales.O_findOne({ where: { Account: { eq: 42 + (i % 100) } } }); }) });
syncResults.push({ name: "findPage", r: runBench("findPage", 1000, () => { syncOrm.sales.O_findPage({ limit: 50, offset: 0 }); }) });
syncResults.push({ name: "count (no filter)", r: runBench("count (no filter)", MEASURE_COUNT, () => { syncOrm.sales.O_count(); }) });
syncResults.push({ name: "count (filtered)", r: runBench("count (filtered)", MEASURE_COUNT, () => { syncOrm.sales.O_count({ Account: { eq: 42 } }); }) });
syncResults.push({ name: "aggregate", r: runBench("aggregate", 1000, () => { syncOrm.sales.O_aggregate({ aggregations: { total: { sum: "Account" } } }); }) });
syncResults.push({ name: "chain findMany", r: runBench("chain findMany", 1000, () => { syncOrm.sales.findMany().limit(100).exec(); }) });
syncResults.push({ name: "chain count", r: runBench("chain count", MEASURE_COUNT, () => { syncOrm.sales.count().exec(); }) });
syncResults.push({ name: "chain findPage", r: runBench("chain findPage", 1000, () => { syncOrm.sales.findPage().limit(50).offset(0).exec(); }) });

for (const { name, r } of syncResults) printLine(name, r);

syncOrm._close();

// --- Async benchmarks --------------------------------------------------------

console.log(`\n--- ASYNC (pool=${POOL_SIZE}) ---`);
const asyncOrm = makeORM(true);

// Warmup
for (let i = 0; i < WARMUP_COUNT; i++) await asyncOrm.sales.findByIdAsync(i % SEED_COUNT);

const asyncResults: Array<{ name: string; r: BenchResult }> = [];

asyncResults.push({ name: "findById", r: await runAsyncBench("findById", MEASURE_COUNT, async (i) => { await asyncOrm.sales.findByIdAsync(i % SEED_COUNT); }) });
asyncResults.push({ name: "findMany (no filter)", r: await runAsyncBench("findMany (no filter)", 1000, async () => { await asyncOrm.sales.O_findManyAsync({ limit: 100 }); }) });
asyncResults.push({ name: "findMany (filter eq)", r: await runAsyncBench("findMany (filter eq)", 1000, async () => { await asyncOrm.sales.O_findManyAsync({ where: { Account: { eq: 42 } }, limit: 100 }); }) });
asyncResults.push({ name: "findMany (flattened)", r: await runAsyncBench("findMany (flattened)", 1000, async () => { await asyncOrm.sales.O_findManyAsync({ where: { "Status.Group": { eq: "PNP" } }, limit: 100 }); }) });
asyncResults.push({ name: "findOne", r: await runAsyncBench("findOne", 1000, async (i) => { await asyncOrm.sales.O_findOneAsync({ where: { Account: { eq: 42 + (i % 100) } } }); }) });
asyncResults.push({ name: "findPage", r: await runAsyncBench("findPage", 1000, async () => { await asyncOrm.sales.O_findPageAsync({ limit: 50, offset: 0 }); }) });
asyncResults.push({ name: "count (no filter)", r: await runAsyncBench("count (no filter)", MEASURE_COUNT, async () => { await asyncOrm.sales.O_countAsync(); }) });
asyncResults.push({ name: "count (filtered)", r: await runAsyncBench("count (filtered)", MEASURE_COUNT, async () => { await asyncOrm.sales.O_countAsync({ Account: { eq: 42 } }); }) });
asyncResults.push({ name: "aggregate", r: await runAsyncBench("aggregate", 1000, async () => { await asyncOrm.sales.O_aggregateAsync({ aggregations: { total: { sum: "Account" } } }); }) });
asyncResults.push({ name: "chain findMany", r: await runAsyncBench("chain findMany", 1000, async () => { await asyncOrm.sales.findMany().limit(100).execAsync(); }) });
asyncResults.push({ name: "chain count", r: await runAsyncBench("chain count", MEASURE_COUNT, async () => { await asyncOrm.sales.count().execAsync(); }) });
asyncResults.push({ name: "chain findPage", r: await runAsyncBench("chain findPage", 1000, async () => { await asyncOrm.sales.findPage().limit(50).offset(0).execAsync(); }) });

for (const { name, r } of asyncResults) printLine(name, r);

// --- Concurrent throughput (async only) --------------------------------------

console.log("\n--- Concurrent async throughput (findMany limit=100, 20 in parallel) ---");

{
  const CONCURRENT = 20;
  const BATCHES = 500;
  Bun.gc(true);
  const wallStart = performance.now();
  let totalOps = 0;

  for (let b = 0; b < BATCHES; b++) {
    const batch: Promise<unknown>[] = [];
    for (let j = 0; j < CONCURRENT; j++) {
      batch.push(asyncOrm.sales.O_findManyAsync({ limit: 100 }));
    }
    await Promise.all(batch);
    totalOps += CONCURRENT;
  }

  const wallMs = performance.now() - wallStart;
  const opsSec = (totalOps / (wallMs / 1000));
  console.log(`  ${totalOps} reads in ${fmt(wallMs)}ms = ${fmt(opsSec)} ops/sec`);
  console.log(`  (${CONCURRENT} parallel × ${BATCHES} batches, ${POOL_SIZE} workers)`);
}

asyncOrm._close();

// --- Summary table -----------------------------------------------------------

console.log("\n" + "=".repeat(94));
console.log("  SYNC vs ASYNC READER POOL - COMPARISON");
console.log("=".repeat(94));
console.log("");
console.log(
  `  ${"Benchmark".padEnd(30)} ` +
  `${"sync mean".padStart(9)} ` +
  `${"async mean".padStart(9)} ` +
  `${"sync ops/s".padStart(12)} ` +
  `${"async ops/s".padStart(12)} ` +
  `${"speedup".padStart(10)}`
);
console.log("  " + "-".repeat(83));

const syncMap = new Map(syncResults.map(({ name, r }) => [name, r]));
const asyncMap = new Map(asyncResults.map(({ name, r }) => [name, r]));
const allNames = [...new Set([...syncMap.keys(), ...asyncMap.keys()])];

for (const name of allNames) {
  const s = syncMap.get(name);
  const a = asyncMap.get(name);
  if (!s || !a) continue;
  const ratio = s.meanUs / a.meanUs;
  const syncOps = fmt(s.ops / (s.wallMs / 1000));
  const asyncOps = fmt(a.ops / (a.wallMs / 1000));
  const speedup = fmt(ratio) + "x";
  const speedupTag = ratio >= 1.05 ? "  ▲" : ratio <= 0.95 ? "  ▼" : "  -";

  console.log(
    `  ${name.padEnd(30)} ` +
    `${fmt(s.meanUs).padStart(8)}us ` +
    `${fmt(a.meanUs).padStart(8)}us ` +
    `${syncOps.padStart(11)} ` +
    `${asyncOps.padStart(11)} ` +
    `${speedup.padStart(8)}${speedupTag}`
  );
}

console.log("");
console.log("  Configuration:");
console.log(`    Seed rows: ${SEED_COUNT}`);
console.log(`    Measured ops per test: ${MEASURE_COUNT}`);
console.log(`    Worker pool size: ${POOL_SIZE}`);
console.log(`    DB path: ${DB_PATH}`);

// --- Cleanup -----------------------------------------------------------------

try {
  const { existsSync, unlinkSync } = await import("node:fs");
  for (const p of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (existsSync(p)) unlinkSync(p);
  }
} catch { /* ignore */ }

console.log("\nDone.");
