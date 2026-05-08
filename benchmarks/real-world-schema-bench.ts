import { createORM, table } from "../src/index.ts";
import { SaleSchema } from "../tests/real-world-types/index.ts";
import type { Sale } from "../tests/real-world-types/index.ts";

const WARMUP_MS = 500;
const MAX_TEST_MS = 10000;
const PROGRESSION_FACTOR = 2;

function makeORM(indexed = false) {
  return createORM({
    // path: ":memory:",
    path: "./bench.db",
    rebuildOnLaunch: true,
    tables: {
      sales: table(SaleSchema, (s) => ({
        primaryKey: s.OrderNumber,
        indexes: indexed ? [{ columns: [s.Status__Group] }] : [],
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
        AddressField1: `${n} Main St`,
        AddressField2: "Suite 100",
        AddressField3: null,
        State: null,
        ZipCity: "Copenhagen 1000",
        Country: "DK",
        Attention: "John Doe",
        DeliveryAddress: {
          AddressField1: "456 Warehouse Rd",
          AddressField2: null,
          AddressField3: null,
          AddressField4: null,
          AddressField5: null,
          Country: "DK",
          Attention: "Receiving",
          Phone: "+45 12345678",
          NoteEmail: "receive@acme.dk",
        },
      },
      CustomerContact: {
        Phone: "+45 87654321",
        Fax: null,
        Email: `customer${n}@test.dk`,
      },
    },
    Pricing: {
      TotalMargin: 500 + n,
      TotalTurnover: 2500 + n,
      TotalCostPrice: 2000 + n,
      TotalMarginDKK: 500 + n,
      TotalTurnoverDKK: 2500 + n,
      TotalCostPriceDKK: 2000 + n,
      Invoices: [
        {
          RowNumber: 1,
          LastChanged: "2024-01-15T10:30:00Z",
          BudgetCode: "SALES",
          Account: 42,
          Department: null,
          Date: "2024-01-15",
          InvoiceNumber: 1001 + n,
          Voucher: "V001",
          Text: `Invoice ${n}`,
          TransactionType: 1,
          AmountMST: 2500 + n,
          AmountCur: 2500 + n,
          Currency: "DKK",
          Vat: "25",
          VatAmount: 500,
          Approved: true,
          ApprovedBy: "ADMIN",
          CashDiscountAmount: 0,
          CashDiscountDate: null,
          DueDate: "2024-02-15",
          Open: false,
          ExchangeRate: 100,
          Reserved2: null,
          Reserved3: null,
          PostedDiffAmount: 0,
          RefRecId: null,
          Transaction: 1,
          ReminderCode: null,
          CashDiscount: null,
          RemindedDate: null,
          ExchangeRateTri: 100,
          PaymentId: "PAY001",
          Centre: null,
          Purpose: null,
          PaymentMode: "BANK",
          ReminderSent: false,
        },
      ],
      VATNumber: "DK12345678",
      VATNumberType: "SE",
      Currency: "DKK",
      EstimatedOrderExchangeRate: 100,
      PaymentTerms: "NET30",
    },
    Shipping: {
      DeliveryTerms: "DDP",
      TrackingNumber: `TRACK${n}`,
      TrackingType: 5,
      ShippingService: "PostDK",
      ShippingAccountType: "OWN",
      FreightDimensions: {
        Weight: 10.5,
        Length: 50,
        Height: 30,
        Width: 40,
      },
    },
    Reference: {
      YourRef: `PO-${n}`,
      OurRef: `REF-${n}`,
      Purpose: "Standard order",
      SalesChannel: "WEB",
    },
    Status: {
      Blocked: false,
      OrderPhase: 2,
      IsSalesPhase: 1,
      Group: ["PNP", "TECH", "RMA"][n % 3],
      ExtendedDocumentsLink: null,
      OrderStatus: "ACTIVE",
    },
    HandledBy: {
      SalesRep: "ABC",
      Bearer: null,
      PickedBy: null,
      TestedBy: null,
      PackedBy: null,
      BookedBy: null,
    },
    Testing: {
      TestHours: null,
      TestMinutes: null,
    },
    Logs: [
      { raw: "Order created", timestamp: "2024-01-10T08:00:00Z", type: "ORDER_CREATED", metadata: [], metatags: [] },
    ],
    SalesLineItems: [
      {
        OrderNumber: n,
        LineNumber: 1,
        ItemNumber: `WID-${n}`,
        ItemName: `Widget ${n}`,
        Location: "WH-A1",
        ManufacturerGroup: "PNP",
        Quantity: 10,
        Discount: 0,
        Price: 100,
        PriceDKK: 100,
        PriceAmount: 1000,
        PriceAmountDKK: 1000,
        CostPrice: 80,
        CostPriceAmount: 800,
        Margin: 200,
        DeliverNow: 10,
        CreatedDate: "2024-01-10T08:00:00Z",
        DeliveryDate: "2024-01-20T00:00:00Z",
        SerialNumber: null,
        Delivered: 0,
        LastChanged: "2024-01-15T10:30:00Z",
      },
      {
        OrderNumber: n,
        LineNumber: 2,
        ItemNumber: `GAD-${n}`,
        ItemName: `Gadget ${n}`,
        Location: "WH-B2",
        ManufacturerGroup: "TECH",
        Quantity: 5,
        Discount: 10,
        Price: 300,
        PriceDKK: 300,
        PriceAmount: 1500,
        PriceAmountDKK: 1500,
        CostPrice: 240,
        CostPriceAmount: 1200,
        Margin: 300,
        DeliverNow: 5,
        CreatedDate: "2024-01-10T08:00:00Z",
        DeliveryDate: "2024-01-20T00:00:00Z",
        SerialNumber: null,
        Delivered: 0,
        LastChanged: "2024-01-15T10:30:00Z",
      },
    ],
  } as Sale;
}

function mem(): { rssMB: number; heapMB: number } {
  const u = process.memoryUsage();
  return { rssMB: Math.round(u.rss / 1024 / 1024 * 100) / 100, heapMB: Math.round(u.heapUsed / 1024 / 1024 * 100) / 100 };
}

async function runBenchmark(name: string, fn: (count: number) => void | Promise<void>): Promise<void> {
  console.log(`\n--- ${name} ---`);
  let count = 100;
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_TEST_MS) {
    const orm = makeORM();
    const m0 = mem();
    const t0 = process.cpuUsage();
    const iterStart = performance.now();

    try {
      await fn(count);
    } catch (e: any) {
      console.log(`BROKEN at count=${count} after ${Date.now() - startTime}ms: ${e.message}`);
      orm._close();
      return;
    }

    const iterMs = performance.now() - iterStart;
    const t1 = process.cpuUsage(t0);
    const m1 = mem();
    const opsSec = Math.round((count / (iterMs / 1000)) * 100) / 100;
    const cpuMs = (t1.user + t1.system) / 1000;
    const cpuPerOp = Math.round((cpuMs / count) * 1000 * 100) / 100;
    const rssDelta = Math.round((m1.rssMB - m0.rssMB) * 100) / 100;
    const heapDelta = Math.round((m1.heapMB - m0.heapMB) * 100) / 100;

    console.log(`count=${count.toString().padStart(7)}  ops/sec=${opsSec.toString().padStart(12)}  iterMs=${Math.round(iterMs).toString().padStart(6)}  cpuMs=${Math.round(cpuMs).toString().padStart(6)}  cpuPerOpUs=${cpuPerOp.toString().padStart(8)}  rssMB=${m1.rssMB.toString().padStart(8)}  rssDeltaMB=${rssDelta.toString().padStart(8)}  heapDeltaMB=${heapDelta.toString().padStart(8)}`);

    orm._close();

    if (iterMs > MAX_TEST_MS / 2) {
      console.log(`SLOW: iteration took ${Math.round(iterMs)}ms, stopping progression`);
      break;
    }

    count *= PROGRESSION_FACTOR;
    Bun.gc(true);
  }
}

// Warmup
console.log("Warming up...");
{
  const orm = makeORM();
  for (let i = 0; i < 100; i++) orm.sales.insert(makeSale(i));
  orm.sales.findById(50);
  orm.sales.findMany({ limit: 50 });
  orm._close();
}

// Benchmark 1: Insert throughput
await runBenchmark("INSERT throughput", (count) => {
  const orm = makeORM();
  for (let i = 0; i < count; i++) orm.sales.insert(makeSale(i));
  orm._close();
});

// Benchmark 2: InsertMany throughput
await runBenchmark("INSERTMANY throughput", (count) => {
  const orm = makeORM();
  orm.sales.insertMany(Array.from({ length: count }, (_, i) => makeSale(i)));
  orm._close();
});

// Benchmark 3: findById (preloaded)
await runBenchmark("FINDBYID throughput", (count) => {
  const orm = makeORM();
  for (let i = 0; i < count; i++) orm.sales.insert(makeSale(i));
  const t0 = performance.now();
  for (let i = 0; i < count; i++) orm.sales.findById(i);
  const dt = performance.now() - t0;
  console.log(`  [inner] ${count} findById in ${Math.round(dt)}ms = ${Math.round(count / (dt / 1000))} ops/sec`);
  orm._close();
});

// Benchmark 4: findMany no-filter paginated
await runBenchmark("FINDMANY paginated throughput", (count) => {
  const orm = makeORM();
  for (let i = 0; i < count; i++) orm.sales.insert(makeSale(i));
  const t0 = performance.now();
  orm.sales.findMany({ limit: Math.min(count, 1000) });
  const dt = performance.now() - t0;
  console.log(`  [inner] paginated findMany(limit=${Math.min(count, 1000)}) in ${Math.round(dt)}ms`);
  orm._close();
});

// Benchmark 5: Flattened column query (no index)
await runBenchmark("Flattened column query (no index)", (count) => {
  const orm = makeORM();
  for (let i = 0; i < count; i++) orm.sales.insert(makeSale(i));
  const t0 = performance.now();
  for (let i = 0; i < Math.min(count, 100); i++) {
    orm.sales.findMany({ where: { "Status.Group": { eq: "PNP" } } });
  }
  const dt = performance.now() - t0;
  console.log(`  [inner] ${Math.min(count, 100)} flattened queries in ${Math.round(dt)}ms = ${Math.round(Math.min(count, 100) / (dt / 1000))} ops/sec`);
  orm._close();
});

// Benchmark 5b: Flattened column query (with index)
await runBenchmark("Flattened column query (with index)", (count) => {
  const orm = makeORM(true);
  for (let i = 0; i < count; i++) orm.sales.insert(makeSale(i));
  const t0 = performance.now();
  for (let i = 0; i < Math.min(count, 100); i++) {
    orm.sales.findMany({ where: { "Status.Group": { eq: "PNP" } } });
  }
  const dt = performance.now() - t0;
  console.log(`  [inner] ${Math.min(count, 100)} indexed flattened queries in ${Math.round(dt)}ms = ${Math.round(Math.min(count, 100) / (dt / 1000))} ops/sec`);
  orm._close();
});

// Benchmark 5c: True JSON path query (depth-2, always JSON_EXTRACT)
await runBenchmark("True JSON path query throughput", (count) => {
  const orm = makeORM();
  for (let i = 0; i < count; i++) orm.sales.insert(makeSale(i));
  const t0 = performance.now();
  for (let i = 0; i < Math.min(count, 100); i++) {
    orm.sales.findMany({ where: { "CustomerInfo.CustomerAddress.Country": { eq: "DK" } } });
  }
  const dt = performance.now() - t0;
  console.log(`  [inner] ${Math.min(count, 100)} JSON path queries in ${Math.round(dt)}ms = ${Math.round(Math.min(count, 100) / (dt / 1000))} ops/sec`);
  orm._close();
});

// Benchmark 6: Sub-table hydration
await runBenchmark("SUBTABLE hydration throughput", (count) => {
  const orm = makeORM();
  for (let i = 0; i < Math.min(count, 10000); i++) orm.sales.insert(makeSale(i));
  const t0 = performance.now();
  orm.sales.findMany({ include: ["SalesLineItems"], limit: Math.min(count, 1000) });
  const dt = performance.now() - t0;
  console.log(`  [inner] hydrated ${Math.min(count, 1000)} rows with sub-table in ${Math.round(dt)}ms`);
  orm._close();
});

// Benchmark 7: Update throughput
await runBenchmark("UPDATE throughput", (count) => {
  const orm = makeORM();
  for (let i = 0; i < count; i++) orm.sales.insert(makeSale(i));
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    orm.sales.update({ OrderNumber: i, SearchName: `Updated ${i}` });
  }
  const dt = performance.now() - t0;
  console.log(`  [inner] ${count} updates in ${Math.round(dt)}ms = ${Math.round(count / (dt / 1000))} ops/sec`);
  orm._close();
});

// Benchmark 8: Count / aggregate
await runBenchmark("COUNT aggregate throughput", (count) => {
  const orm = makeORM();
  for (let i = 0; i < count; i++) orm.sales.insert(makeSale(i));
  const t0 = performance.now();
  orm.sales.count({});
  const dt = performance.now() - t0;
  console.log(`  [inner] count() over ${count} rows in ${Math.round(dt)}ms`);
  orm._close();
});

// Benchmark 9: Mixed workload
await runBenchmark("MIXED workload", (count) => {
  const orm = makeORM();
  for (let i = 0; i < count; i++) orm.sales.insert(makeSale(i));
  const t0 = performance.now();
  const batch = Math.min(count, 1000);
  for (let i = 0; i < batch; i++) {
    orm.sales.findById(i % count);
    if (i % 10 === 0) orm.sales.update({ OrderNumber: i % count, SearchName: `Mix ${i}` });
    if (i % 50 === 0) orm.sales.findMany({ where: { Account: { eq: 42 } }, limit: 10 });
  }
  const dt = performance.now() - t0;
  console.log(`  [inner] ${batch} mixed ops in ${Math.round(dt)}ms = ${Math.round(batch / (dt / 1000))} ops/sec`);
  orm._close();
});

// Benchmark 10: Memory pressure (insert only, watch RSS)
console.log("\n--- MEMORY PRESSURE test ---");
{
  const orm = makeORM();
  let total = 0;
  const batch = 1000;
  const start = Date.now();
  const mStart = mem();
  while (Date.now() - start < MAX_TEST_MS) {
    for (let i = 0; i < batch; i++) orm.sales.insert(makeSale(total + i));
    total += batch;
    const m = mem();
    if (total % 10000 === 0) {
      console.log(`inserted=${total}  rssMB=${m.rssMB}  heapMB=${m.heapMB}  rssDeltaMB=${Math.round((m.rssMB - mStart.rssMB) * 100) / 100}`);
    }
  }
  const mEnd = mem();
  console.log(`FINAL inserted=${total}  rssMB=${mEnd.rssMB}  heapMB=${mEnd.heapMB}  rssDeltaMB=${Math.round((mEnd.rssMB - mStart.rssMB) * 100) / 100}`);
  orm._close();
}

console.log("\n--- DONE ---");
