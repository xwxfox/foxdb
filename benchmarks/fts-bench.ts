import { createORM, table } from "../src/index.ts";
import { SaleSchema } from "../tests/real-world-types/index.ts";
import type { Sale } from "../tests/real-world-types/index.ts";

const WARMUP_MS = 500;
const MAX_TEST_MS = 3000;
const PROGRESSION_FACTOR = 2;

function makeORM(fts: boolean) {
  return createORM({
    path: "./fts-bench.db",
    rebuildOnLaunch: true,
    tables: {
      sales: table(SaleSchema, (s) => ({
        primaryKey: s.OrderNumber,
        autoIndex: false,
        ...(fts ? { fts: { columns: [s.SearchName] } } : {}),
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
    const m0 = mem();
    const t0 = process.cpuUsage();
    const iterStart = performance.now();

    try {
      await fn(count);
    } catch (e: any) {
      console.log(`BROKEN at count=${count} after ${Date.now() - startTime}ms: ${e.message}`);
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

    if (iterMs > MAX_TEST_MS / 2) {
      console.log(`SLOW: iteration took ${Math.round(iterMs)}ms, stopping progression`);
      break;
    }

    count *= PROGRESSION_FACTOR;
    Bun.gc(true);
  }
}

async function compare(name: string, fn: (orm: ReturnType<typeof makeORM>, count: number) => void) {
  console.log(`\n=== ${name}: NO-FTS vs FTS ===`);
  await runBenchmark(`${name} [no-fts]`, (count) => { const orm = makeORM(false); fn(orm, count); orm._close(); });
  await runBenchmark(`${name} [fts]`,    (count) => { const orm = makeORM(true);  fn(orm, count); orm._close(); });
}

// Warmup
console.log("Warming up...");
{
  const orm = makeORM(true);
  for (let i = 0; i < 100; i++) orm.sales.insert(makeSale(i));
  orm.sales.search("Customer").limit(20).exec();
  orm._close();
}

// INSERT
await compare("INSERT", (orm, count) => {
  for (let i = 0; i < count; i++) orm.sales.insert(makeSale(i));
});

// INSERTMANY
await compare("INSERTMANY", (orm, count) => {
  orm.sales.insertMany(Array.from({ length: count }, (_, i) => makeSale(i)));
});

// UPDATE
await compare("UPDATE", (orm, count) => {
  for (let i = 0; i < count; i++) orm.sales.insert(makeSale(i));
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    orm.sales.update({ OrderNumber: i, SearchName: `Updated ${i}` });
  }
  const dt = performance.now() - t0;
  console.log(`  [inner] ${count} updates in ${Math.round(dt)}ms = ${Math.round(count / (dt / 1000))} ops/sec`);
});

// UPSERTMANY
await compare("UPSERTMANY", (orm, count) => {
  orm.sales.upsertMany({ data: Array.from({ length: count }, (_, i) => makeSale(i)), conflictTarget: "OrderNumber" });
});

// SEARCH micro-bench (FTS only)
console.log("\n--- SEARCH micro-bench (FTS only) ---");
{
  const N = 5000;
  const orm = makeORM(true);
  for (let i = 0; i < N; i++) orm.sales.insert(makeSale(i));

  const iters = 100;
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) {
    orm.sales.search("Customer").limit(20).exec();
  }
  const dt = performance.now() - t0;
  const opsSec = Math.round((iters / (dt / 1000)) * 100) / 100;
  console.log(`  ${iters} searches over ${N} rows in ${Math.round(dt)}ms = ${opsSec} ops/sec`);
  orm._close();
}

console.log("\n--- DONE ---");
