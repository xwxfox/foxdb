/**
 * Single-operation diagnostic benchmark.
 * Runs each ORM operation exactly once to measure individual overhead.
 * Run with: bun --feature DEBUG_TRACING --feature DEBUG_SQL_BUILDING run ./benchmarks/diag-bench.ts
 */
import { createORM, table } from "../index.ts";
import { SaleSchema } from "../tests/real-world-types/index.ts";
import type { Sale } from "../tests/real-world-types/index.ts";
import {
  resetTrace,
  printTraceSummary,
  printTraceRoots,
} from "../tracing.ts";

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
      Group: "PNP",
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

// --- Helpers ------------------------------------------------------------------

let _seq = 1000;
function label(name: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${"=".repeat(60)}`);
  resetTrace();
}

function printStats(): void {
  printTraceSummary({ minTotalUs: 0 });
}

// --- Setup --------------------------------------------------------------------

resetTrace();

const orm = createORM({
  path: ":memory:",
  rebuildOnLaunch: true,
  tables: {
    sales: table(SaleSchema, (s) => ({
      primaryKey: s.OrderNumber,
      indexes: [{ columns: [s.Status__Group] }],
    })),
  },
});

// --- 1. PARSE -----------------------------------------------------------------

label("parse()");
const data = makeSale(1);
orm.sales.parse(data);
printStats();

// --- 2. CHECK -----------------------------------------------------------------

label("check()");
orm.sales.check(data);
printStats();

// --- 3. INSERT (no sub-tables) ------------------------------------------------

label("insert() - with sub-table data");
resetTrace();
const s1 = makeSale(++_seq);
orm.sales.insert(s1);
printStats();

// --- 4. INSERT (simple, no sub-tables) ----------------------------------------
// We can't easily remove sub-tables since they're part of the schema, but we
// can insert without providing SalesLineItems if it's Optional

// --- 5. INSERTMANY (2 records) -----------------------------------------------

label("insertMany() - 2 records");
resetTrace();
orm.sales.insertMany([makeSale(++_seq), makeSale(++_seq)]);
printStats();

// --- 6. FINDBYID --------------------------------------------------------------

label("findById()");
resetTrace();
orm.sales.findById(_seq);
printStats();

// --- 7. O_FINDMANY (no where, no include) -------------------------------------

label("O_findMany() - unfiltered, limit 5");
resetTrace();
orm.sales.O_findMany({ limit: 5 });
printStats();

// --- 8. O_FINDMANY (with WHERE) -----------------------------------------------

label("O_findMany() - filtered, where Account eq 42");
resetTrace();
orm.sales.O_findMany({ where: { Account: { eq: 42 } }, limit: 5 });
printStats();

// --- 9. O_FINDMANY (with WHERE on flattened column) ---------------------------

label("O_findMany() - flattened where Status.Group eq PNP");
resetTrace();
orm.sales.O_findMany({ where: { "Status.Group": { eq: "PNP" } }, limit: 5 });
printStats();

// --- 10. O_FINDMANY (with INCLUDE - sub-table hydration) -----------------------

label("O_findMany() - with include SalesLineItems");
resetTrace();
orm.sales.O_findMany({ include: ["SalesLineItems"], limit: 3 });
printStats();

// --- 11. O_FINDMANY (JSON path query) -----------------------------------------

label("O_findMany() - JSON path where CustomerInfo.CustomerAddress.Country eq DK");
resetTrace();
orm.sales.O_findMany({ where: { "CustomerInfo.CustomerAddress.Country": { eq: "DK" } }, limit: 5 });
printStats();

// --- 12. O_FINDONE ------------------------------------------------------------

label("O_findOne()");
resetTrace();
orm.sales.O_findOne({ where: { Account: { eq: 42 } } });
printStats();

// --- 13. O_FINDPAGE -----------------------------------------------------------

label("O_findPage() - page 1, limit 3");
resetTrace();
orm.sales.O_findPage({ limit: 3, offset: 1 });
printStats();

// --- 14. O_COUNT --------------------------------------------------------------

label("O_count() - unfiltered");
resetTrace();
orm.sales.O_count();
printStats();

// --- 15. O_COUNT (filtered) ---------------------------------------------------

label("O_count() - filtered where Account eq 42");
resetTrace();
orm.sales.O_count({ Account: { eq: 42 } });
printStats();

// --- 16. UPDATE ---------------------------------------------------------------

label("update()");
resetTrace();
orm.sales.update({ OrderNumber: _seq, SearchName: `Updated ${_seq}` });
printStats();

// --- 17. UPDATE (with sub-table data) -----------------------------------------

label("update() - with sub-table data");
resetTrace();
orm.sales.update({ OrderNumber: _seq - 1, SearchName: `Updated ${_seq - 1}`, SalesLineItems: [] });
printStats();

// --- 18. UPDATEWHERE ----------------------------------------------------------

label("updateWhere()");
resetTrace();
orm.sales.updateWhere({ where: { Account: { eq: 42 } }, data: { SearchName: "Updated where" } });
printStats();

// --- 19. UPSERT ---------------------------------------------------------------

label("upsert() - conflict on OrderNumber");
resetTrace();
orm.sales.upsert({ data: makeSale(++_seq), conflictTarget: "OrderNumber" });
printStats();

// --- 20. UPSERTMANY -----------------------------------------------------------

label("upsertMany() - 2 records");
resetTrace();
orm.sales.upsertMany({ data: [makeSale(++_seq), makeSale(++_seq)], conflictTarget: "OrderNumber" });
printStats();

// --- 21. CHAIN API: findMany --------------------------------------------------

label("findMany() chain - .where().limit().exec()");
resetTrace();
orm.sales.findMany().equals("Account", 42).limit(5).exec();
printStats();

// --- 22. CHAIN API: findOne ---------------------------------------------------

label("findOne() chain - .where().exec()");
resetTrace();
orm.sales.findOne().equals("OrderNumber", _seq).exec();
printStats();

// --- 23. CHAIN API: count -----------------------------------------------------

label("count() chain - .where().exec()");
resetTrace();
orm.sales.count().equals("Account", 42).exec();
printStats();

// --- 24. CHAIN API: findPage --------------------------------------------------

label("findPage() chain - .limit().page().exec()");
resetTrace();
orm.sales.findPage().equals("Account", 42).limit(3).offset(1).exec();
printStats();

// --- 25. DELETE BY ID ---------------------------------------------------------

label("deleteById()");
resetTrace();
orm.sales.deleteById(_seq - 2);
printStats();

// --- 26. O_ITERATE ------------------------------------------------------------

label("O_iterate() - 3 rows");
resetTrace();
let _iterCount = 0;
for (const _row of orm.sales.O_iterate({ limit: 3 })) {
  _iterCount++;
}
printStats();

// --- 27. TRANSACTION ----------------------------------------------------------

label("_transaction() - insert + update");
resetTrace();
orm._transaction(() => {
  orm.sales.insert(makeSale(++_seq));
  orm.sales.update({ OrderNumber: _seq, SearchName: `Tx Updated` });
});
printStats();

// --- 28. FLUSH ----------------------------------------------------------------

label("_flush()");
resetTrace();
orm._flush();
printStats();

// --- 29. DELETE WHERE ---------------------------------------------------------

label("deleteWhere()");
resetTrace();
orm.sales.deleteWhere({ OrderNumber: { eq: _seq + 1 } });
printStats();

// --- Print full trace roots ---------------------------------------------------

console.log(`\n${"=".repeat(60)}`);
console.log("  FULL TRACE ROOTS (top 40 by total time)");
console.log(`${"=".repeat(60)}`);
printTraceRoots({ limit: 40 });

// --- Cleanup ------------------------------------------------------------------

orm._close();
console.log("\nDone.");
