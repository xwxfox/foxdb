import { createORM, table } from "../src/index.ts";
import { SaleSchema, type Sale } from "../tests/real-world-types/index.ts";
import { resetTrace, printTraceSummary } from "../src/tracing.ts";

// -- Configuration ----------------------------------------------
const OP_COUNT = 10_000;         // how many operations per test
const WARMUP_ITER = 1_000;       // warm-up iterations before measuring
const DB_PATH = ":memory:";      // remove I/O noise

// -- Helpers ----------------------------------------------------
function makeORM(indexed = false) {
    return createORM({
        path: DB_PATH,
        rebuildOnLaunch: true,
        tables: {
            sales: table(SaleSchema, (s) => ({
                primaryKey: s.OrderNumber,
                indexes: indexed ? [{ columns: [s.Status__Group] }] : [],
            })),
        },
        bulkLoadMode: true,
        synchronous: "NORMAL"
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

/** Run a function once per operation, collecting per-op latency */
function measureSync(
    label: string,
    opCount: number,
    setup: () => { run: (i: number) => void; teardown?: () => void }
) {
    resetTrace();
    Bun.gc(true);

    const { run, teardown } = setup();
    const times: number[] = Array.from({ length: opCount })
    const cpuStart = process.cpuUsage();

    const wallStart = performance.now();
    for (let i = 0; i < opCount; i++) {
        const t0 = performance.now();
        run(i);
        times[i] = performance.now() - t0;
    }
    const wallEnd = performance.now();
    const cpuDelta = process.cpuUsage(cpuStart);

    if (teardown) teardown();

    const sorted = [...times].sort((a, b) => a - b);
    const sum = times.reduce((s, v) => s + v, 0);
    const mean = sum / opCount;
    const p50 = sorted[Math.floor(opCount * 0.5)]!;
    const p90 = sorted[Math.floor(opCount * 0.9)]!;
    const p99 = sorted[Math.floor(opCount * 0.99)]!;
    const min = sorted[0]!;
    const max = sorted[opCount - 1]!;

    console.log(`\n--- ${label} ---`);
    console.log(`  ops       = ${opCount}`);
    console.log(`  wall time = ${(wallEnd - wallStart).toFixed(1)} ms`);
    console.log(`  cpu time  = ${(cpuDelta.user + cpuDelta.system) / 1000} ms`);
    console.log(`  mean      = ${mean.toFixed(4)} ms`);
    console.log(`  min       = ${min.toFixed(4)} ms`);
    console.log(`  max       = ${max.toFixed(4)} ms`);
    console.log(`  p50       = ${p50.toFixed(4)} ms`);
    console.log(`  p90       = ${p90.toFixed(4)} ms`);
    console.log(`  p99       = ${p99.toFixed(4)} ms`);
    printTraceSummary();   // your aggregated trace output
}

// 1. INSERT throughput
measureSync("INSERT (10k rows)", OP_COUNT, () => {
    const orm = makeORM();
    // warm up
    for (let i = 0; i < WARMUP_ITER; i++) orm.sales.insert(makeSale(i));
    resetTrace();          // reset trace after warmup
    return {
        run: (i) => orm.sales.insert(makeSale(i + WARMUP_ITER)),
        teardown: () => orm._close(),
    };
});

// 2. INSERT MANY (batch of 100)
measureSync("INSERT MANY (100 batches of 100)", 100, () => {
    const orm = makeORM();
    for (let i = 0; i < 1_000; i++) orm.sales.insert(makeSale(i));
    resetTrace();
    return {
        run: (i) => {
            const batch = Array.from({ length: 100 }, (_, j) => makeSale(10_000 + i * 100 + j));
            orm.sales.insertMany(batch);
        },
        teardown: () => orm._close(),
    };
});

// 3. findById
measureSync("findById (10k lookups)", OP_COUNT, () => {
    const orm = makeORM();
    // insert 20k rows so we can look up half of them
    for (let i = 0; i < 20_000; i++) orm.sales.insert(makeSale(i));
    resetTrace();
    return {
        run: (i) => orm.sales.findById(i % 20_000),
        teardown: () => orm._close(),
    };
});

// 4. findMany with limit
measureSync("findMany limit 100", OP_COUNT, () => {
    const orm = makeORM();
    for (let i = 0; i < 20_000; i++) orm.sales.insert(makeSale(i));
    resetTrace();
    return {
        run: () => orm.sales.O_findMany({ limit: 100 }),
        teardown: () => orm._close(),
    };
});

// 5. Update (by primary key)
measureSync("UPDATE (10k updates)", OP_COUNT, () => {
    const orm = makeORM();
    for (let i = 0; i < 20_000; i++) orm.sales.insert(makeSale(i));
    resetTrace();
    return {
        run: (i) => orm.sales.update({ OrderNumber: i % 20_000, SearchName: `Updated ${i}` }),
        teardown: () => orm._close(),
    };
});

// 6. Flattened column query (no index)
measureSync("Filter Status.Group eq PNP (no index)", Math.min(OP_COUNT, 1000), () => {
    const orm = makeORM(); // no index
    for (let i = 0; i < 20_000; i++) orm.sales.insert(makeSale(i));
    resetTrace();
    return {
        run: () => orm.sales.O_findMany({ where: { "Status.Group": { eq: "PNP" } } }),
        teardown: () => orm._close(),
    };
});

// 7. Flattened column query (indexed)
measureSync("Filter Status.Group eq PNP (indexed)", Math.min(OP_COUNT, 1000), () => {
    const orm = makeORM(true); // with index
    for (let i = 0; i < 20_000; i++) orm.sales.insert(makeSale(i));
    resetTrace();
    return {
        run: () => orm.sales.O_findMany({ where: { "Status.Group": { eq: "PNP" } } }),
        teardown: () => orm._close(),
    };
});

// 8. JSON path query (always full scan)
measureSync("JSON path Country eq DK (no index)", Math.min(OP_COUNT, 1000), () => {
    const orm = makeORM();
    for (let i = 0; i < 20_000; i++) orm.sales.insert(makeSale(i));
    resetTrace();
    return {
        run: () => orm.sales.O_findMany({ where: { "CustomerInfo.CustomerAddress.Country": { eq: "DK" } } }),
        teardown: () => orm._close(),
    };
});

// 9. Sub-table hydration
measureSync("Hydrate with SalesLineItems (100 rows)", 100, () => {
    const orm = makeORM();
    for (let i = 0; i < 10_000; i++) orm.sales.insert(makeSale(i));
    resetTrace();
    return {
        run: () => orm.sales.O_findMany({ include: ["SalesLineItems"], limit: 100 }),
        teardown: () => orm._close(),
    };
});

// 10. Mixed sync workload (simulate realistic traffic)
measureSync("MIXED (findById + update + findMany)", OP_COUNT, () => {
    const orm = makeORM();
    for (let i = 0; i < 20_000; i++) orm.sales.insert(makeSale(i));
    resetTrace();
    return {
        run: (i) => {
            const id = i % 20_000;
            orm.sales.findById(id);
            if (i % 10 === 0) orm.sales.update({ OrderNumber: id, SearchName: `Mix ${i}` });
            if (i % 50 === 0) orm.sales.O_findMany({ where: { Account: { eq: 42 } }, limit: 10 });
        },
        teardown: () => orm._close(),
    };
});

console.log("Done.");