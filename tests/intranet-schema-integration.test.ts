import { test, expect, describe } from "bun:test";
import {
  Object,
  String,
  Number,
  Integer,
  Boolean,
  Array,
  Optional,
  Union,
  Null,
  Literal,
} from "typebox";
import { createORM, table } from "../src/index.ts";

// ─── helpers mimicking @inside/models conventions ────────────────────────────

function StrictObject<T extends Record<string, any>>(properties: T) {
  return Object(properties, { additionalProperties: false });
}

const DateValueSchema = String();
const NullableStringSchema = Optional(Union([String(), Null()]));
const NullableNumberSchema = Optional(Union([Number(), Null()]));

// ─── nested schemas (sufficiently complete for the integration test) ─────────

const CustomerDeliveryAddressSchema = StrictObject({
  AddressField1: NullableStringSchema,
  AddressField2: NullableStringSchema,
  AddressField3: NullableStringSchema,
  AddressField4: NullableStringSchema,
  AddressField5: NullableStringSchema,
  Country: NullableStringSchema,
  Attention: NullableStringSchema,
  Phone: NullableStringSchema,
  NoteEmail: NullableStringSchema,
});

const CustomerAddressSchema = StrictObject({
  AddressField1: NullableStringSchema,
  AddressField2: NullableStringSchema,
  AddressField3: NullableStringSchema,
  State: NullableStringSchema,
  ZipCity: NullableStringSchema,
  Country: NullableStringSchema,
  Attention: NullableStringSchema,
  DeliveryAddress: CustomerDeliveryAddressSchema,
});

const CustomerContactSchema = StrictObject({
  Phone: NullableStringSchema,
  Fax: NullableStringSchema,
  Email: NullableStringSchema,
});

const SaleCustomerInfoSchema = StrictObject({
  CustomerName: String(),
  CustomerAddress: CustomerAddressSchema,
  CustomerContact: CustomerContactSchema,
});

const ShippingFreightSchema = StrictObject({
  Weight: NullableNumberSchema,
  Length: NullableNumberSchema,
  Height: NullableNumberSchema,
  Width: NullableNumberSchema,
});

const ShippingSchema = StrictObject({
  DeliveryTerms: NullableStringSchema,
  TrackingNumber: NullableStringSchema,
  TrackingType: NullableNumberSchema,
  ShippingService: NullableStringSchema,
  ShippingAccountType: NullableStringSchema,
  FreightDimensions: ShippingFreightSchema,
});

const ReferenceSchema = StrictObject({
  YourRef: NullableStringSchema,
  OurRef: NullableStringSchema,
  Purpose: NullableStringSchema,
  SalesChannel: NullableStringSchema,
});

const SalePricingSchema = StrictObject({
  TotalMargin: Number(),
  TotalTurnover: Number(),
  TotalCostPrice: Number(),
  TotalMarginDKK: Number(),
  TotalTurnoverDKK: Number(),
  TotalCostPriceDKK: Number(),
  Invoices: Array(
    StrictObject({
      RowNumber: Number(),
      LastChanged: DateValueSchema,
      BudgetCode: Optional(Union([String(), Null()])),
      Account: Number(),
      Department: NullableStringSchema,
      Date: DateValueSchema,
      InvoiceNumber: Number(),
      Voucher: NullableStringSchema,
      Text: NullableStringSchema,
      TransactionType: Number(),
      AmountMST: Number(),
      AmountCur: Number(),
      Currency: NullableStringSchema,
      Vat: Optional(Union([String(), Null()])),
      VatAmount: Number(),
      Approved: Boolean(),
      ApprovedBy: NullableStringSchema,
      CashDiscountAmount: Number(),
      CashDiscountDate: Optional(Union([DateValueSchema, Null()])),
      DueDate: Optional(Union([DateValueSchema, Null()])),
      Open: Boolean(),
      ExchangeRate: Number(),
      Reserved2: NullableNumberSchema,
      Reserved3: NullableNumberSchema,
      PostedDiffAmount: Number(),
      RefRecId: NullableNumberSchema,
      Transaction: Number(),
      ReminderCode: NullableNumberSchema,
      CashDiscount: NullableNumberSchema,
      RemindedDate: Optional(Union([DateValueSchema, Null()])),
      ExchangeRateTri: Number(),
      PaymentId: NullableStringSchema,
      Centre: NullableStringSchema,
      Purpose: NullableStringSchema,
      PaymentMode: NullableStringSchema,
      ReminderSent: Boolean(),
    })
  ),
  VATNumber: NullableStringSchema,
  VATNumberType: NullableStringSchema,
  Currency: NullableStringSchema,
  EstimatedOrderExchangeRate: Number(),
  PaymentTerms: NullableStringSchema,
});

const SaleStatusSchema = StrictObject({
  Blocked: Boolean(),
  OrderPhase: Number(),
  IsSalesPhase: Number(),
  Group: String(),
  ExtendedDocumentsLink: NullableStringSchema,
  OrderStatus: NullableStringSchema,
});

const SaleHandledBySchema = StrictObject({
  SalesRep: NullableStringSchema,
  Bearer: NullableStringSchema,
  PickedBy: NullableStringSchema,
  TestedBy: NullableStringSchema,
  PackedBy: NullableStringSchema,
  BookedBy: NullableStringSchema,
});

const SaleTestingSchema = StrictObject({
  TestHours: NullableNumberSchema,
  TestMinutes: NullableNumberSchema,
});

// Simplified LogEntrySchema – FoxDB stores Logs as JSON TEXT because
// the real LogEntrySchema is a union of objects (IsObject === false).
const LogEntrySchema = StrictObject({
  raw: String(),
  timestamp: DateValueSchema,
  type: String(),
});

export const SaleLineItemSchema = StrictObject({
  OrderNumber: Number(),
  LineNumber: Number(),
  ItemNumber: NullableStringSchema,
  ItemName: NullableStringSchema,
  Location: NullableStringSchema,
  ManufacturerGroup: NullableStringSchema,
  Quantity: Number(),
  Discount: Number(),
  Price: Number(),
  PriceDKK: Number(),
  PriceAmount: Number(),
  PriceAmountDKK: Number(),
  CostPrice: Number(),
  CostPriceAmount: Number(),
  Margin: Number(),
  DeliverNow: Number(),
  CreatedDate: DateValueSchema,
  DeliveryDate: DateValueSchema,
  SerialNumber: NullableStringSchema,
  Delivered: Number(),
  LastChanged: DateValueSchema,
});

export const SaleSchema = StrictObject({
  OrderNumber: Number(),
  OrderTransaction: Number(),
  InvoiceNumbers: Array(Number()),
  LastChanged: DateValueSchema,
  CreatedDate: DateValueSchema,
  DocumentDate: String(),
  DeliveryDate: DateValueSchema,
  Account: Number(),
  InvoiceAccount: Number(),
  SearchName: String(),
  CustomerInfo: SaleCustomerInfoSchema,
  Pricing: SalePricingSchema,
  Shipping: ShippingSchema,
  Reference: ReferenceSchema,
  Status: SaleStatusSchema,
  HandledBy: SaleHandledBySchema,
  Testing: SaleTestingSchema,
  Logs: Array(LogEntrySchema),
  SalesLineItems: Optional(Array(SaleLineItemSchema)),
});

// ─── test factory ────────────────────────────────────────────────────────────

function makeORM() {
  return createORM({
    path: ":memory:",
    rebuildOnLaunch: true,
    tables: {
      sales: table(SaleSchema, (s) => ({ primaryKey: s.OrderNumber })),
    },
  });
}

function createFullSale(orderNumber: number): any {
  return {
    OrderNumber: orderNumber,
    OrderTransaction: 1000 + orderNumber,
    InvoiceNumbers: [1001, 1002],
    LastChanged: "2024-01-15T10:30:00Z",
    CreatedDate: "2024-01-10T08:00:00Z",
    DocumentDate: "2024-01-12",
    DeliveryDate: "2024-01-20T00:00:00Z",
    Account: 42,
    InvoiceAccount: 42,
    SearchName: "ACME Corp",
    CustomerInfo: {
      CustomerName: "ACME Corporation",
      CustomerAddress: {
        AddressField1: "123 Main St",
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
        Email: "contact@acme.dk",
      },
    },
    Pricing: {
      TotalMargin: 500,
      TotalTurnover: 2500,
      TotalCostPrice: 2000,
      TotalMarginDKK: 500,
      TotalTurnoverDKK: 2500,
      TotalCostPriceDKK: 2000,
      Invoices: [
        {
          RowNumber: 1,
          LastChanged: "2024-01-15T10:30:00Z",
          BudgetCode: "SALES",
          Account: 42,
          Department: null,
          Date: "2024-01-15",
          InvoiceNumber: 1001,
          Voucher: "V001",
          Text: "Invoice 1001",
          TransactionType: 1,
          AmountMST: 2500,
          AmountCur: 2500,
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
      TrackingNumber: "TRACK123",
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
      YourRef: "PO-12345",
      OurRef: "REF-67890",
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
      { raw: "Order created", timestamp: "2024-01-10T08:00:00Z", type: "ORDER_CREATED" },
      { raw: "Order confirmed", timestamp: "2024-01-11T09:00:00Z", type: "CONFIRMED" },
    ],
    SalesLineItems: [
      {
        OrderNumber: orderNumber,
        LineNumber: 1,
        ItemNumber: "WID-001",
        ItemName: "Widget A",
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
        OrderNumber: orderNumber,
        LineNumber: 2,
        ItemNumber: "GAD-002",
        ItemName: "Gadget B",
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
  };
}

// ─── integration tests ───────────────────────────────────────────────────────

describe("intranet SaleSchema integration", () => {
  test("roundtrip: insert full sale and findById hydrates everything", () => {
    const orm = makeORM();
    const input = createFullSale(1);
    orm.sales.insert(input);

    const found = orm.sales.findById(1);
    expect(found).not.toBeNull();

    const s = found!;
    expect(s.OrderNumber).toBe(1);
    expect(s.OrderTransaction).toBe(1001);
    expect(s.Account).toBe(42);
    expect(s.InvoiceAccount).toBe(42);
    expect(s.SearchName).toBe("ACME Corp");

    // Arrays of primitives survived roundtrip
    expect(s.InvoiceNumbers).toEqual([1001, 1002]);

    // Nested objects hydrated
    expect(s.CustomerInfo.CustomerName).toBe("ACME Corporation");
    expect(s.CustomerInfo.CustomerAddress.AddressField1).toBe("123 Main St");
    expect(s.CustomerInfo.CustomerAddress.DeliveryAddress.Attention).toBe("Receiving");
    expect(s.CustomerInfo.CustomerContact.Email).toBe("contact@acme.dk");

    expect(s.Pricing.TotalTurnoverDKK).toBe(2500);
    expect(s.Pricing.Invoices).toHaveLength(1);
    expect(s.Pricing.Invoices[0].InvoiceNumber).toBe(1001);

    expect(s.Shipping.TrackingNumber).toBe("TRACK123");
    expect(s.Reference.YourRef).toBe("PO-12345");

    expect(s.Status.Group).toBe("PNP");
    expect(s.Status.Blocked).toBe(false);

    expect(s.HandledBy.SalesRep).toBe("ABC");
    expect(s.Testing.TestHours).toBeNull();

    // Logs array (stored as JSON TEXT)
    expect(s.Logs).toHaveLength(2);
    expect(s.Logs[0].type).toBe("ORDER_CREATED");

    // Sub-table hydrated
    expect(s.SalesLineItems).toHaveLength(2);
    expect(s.SalesLineItems[0].ManufacturerGroup).toBe("PNP");
    expect(s.SalesLineItems[1].ManufacturerGroup).toBe("TECH");

    orm._close();
  });

  test("find by top-level scalar: Account eq 42", () => {
    const orm = makeORM();
    orm.sales.insert(createFullSale(1));
    orm.sales.insert({ ...createFullSale(2), Account: 99 });

    const results = orm.sales.findMany({ where: { Account: { eq: 42 } } });
    expect(results).toHaveLength(1);
    expect(results[0].OrderNumber).toBe(1);

    orm._close();
  });

  test("find by nested JSON path: Pricing.TotalTurnoverDKK gt 1000", () => {
    const orm = makeORM();
    orm.sales.insert(createFullSale(1));
    orm.sales.insert({ ...createFullSale(2), Pricing: { ...createFullSale(2).Pricing, TotalTurnoverDKK: 500 } });

    const results = orm.sales.findMany({
      where: { "Pricing.TotalTurnoverDKK": { gt: 1000 } },
    });
    expect(results).toHaveLength(1);
    expect(results[0].OrderNumber).toBe(1);

    orm._close();
  });

  test("find by nested JSON path: Status.Group eq PNP", () => {
    const orm = makeORM();
    orm.sales.insert(createFullSale(1));
    orm.sales.insert({ ...createFullSale(2), Status: { ...createFullSale(2).Status, Group: "TECH" } });

    const results = orm.sales.findMany({
      where: { "Status.Group": { eq: "PNP" } },
    });
    expect(results).toHaveLength(1);
    expect(results[0].OrderNumber).toBe(1);

    orm._close();
  });

  test("find by nested JSON path: HandledBy.SalesRep eq ABC", () => {
    const orm = makeORM();
    orm.sales.insert(createFullSale(1));
    orm.sales.insert({ ...createFullSale(2), HandledBy: { ...createFullSale(2).HandledBy, SalesRep: "XYZ" } });

    const results = orm.sales.findMany({
      where: { "HandledBy.SalesRep": { eq: "ABC" } },
    });
    expect(results).toHaveLength(1);
    expect(results[0].OrderNumber).toBe(1);

    orm._close();
  });

  test("find with AND logical operator", () => {
    const orm = makeORM();
    orm.sales.insert(createFullSale(1));
    orm.sales.insert({ ...createFullSale(2), Status: { ...createFullSale(2).Status, Group: "TECH" } });
    orm.sales.insert({ ...createFullSale(3), Pricing: { ...createFullSale(3).Pricing, TotalTurnoverDKK: 500 } });

    const results = orm.sales.findMany({
      where: {
        AND: [
          { "Status.Group": { eq: "PNP" } },
          { "Pricing.TotalTurnoverDKK": { gt: 1000 } },
        ],
      },
    });
    expect(results).toHaveLength(1);
    expect(results[0].OrderNumber).toBe(1);

    orm._close();
  });

  test("find with OR logical operator", () => {
    const orm = makeORM();
    orm.sales.insert(createFullSale(1));
    orm.sales.insert({ ...createFullSale(2), Status: { ...createFullSale(2).Status, Group: "TECH" } });
    orm.sales.insert({ ...createFullSale(3), Status: { ...createFullSale(3).Status, Group: "RMA" } });

    const results = orm.sales.findMany({
      where: {
        OR: [
          { "Status.Group": { eq: "PNP" } },
          { "Status.Group": { eq: "TECH" } },
        ],
      },
    });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.OrderNumber).sort()).toEqual([1, 2]);

    orm._close();
  });

  test("find with sub-table include hydrates SalesLineItems", () => {
    const orm = makeORM();
    orm.sales.insert(createFullSale(1));

    const results = orm.sales.findMany({ include: ["SalesLineItems"] });
    expect(results).toHaveLength(1);
    expect(results[0].SalesLineItems).toHaveLength(2);
    expect(results[0].SalesLineItems[0].ItemNumber).toBe("WID-001");
    expect(results[0].SalesLineItems[1].ItemNumber).toBe("GAD-002");

    orm._close();
  });

  test("find with explicit empty include returns empty SalesLineItems array", () => {
    const orm = makeORM();
    orm.sales.insert(createFullSale(1));

    const results = orm.sales.findMany({ include: [] });
    expect(results).toHaveLength(1);
    expect(results[0].SalesLineItems).toEqual([]);

    orm._close();
  });

  test("arrays of primitives survive roundtrip (InvoiceNumbers)", () => {
    const orm = makeORM();
    orm.sales.insert(createFullSale(1));

    const found = orm.sales.findById(1);
    expect(found).not.toBeNull();
    expect(found!.InvoiceNumbers).toEqual([1001, 1002]);

    orm._close();
  });

  test("returned record has correct nested shape with exact values", () => {
    const orm = makeORM();
    const input = createFullSale(1);
    orm.sales.insert(input);

    const found = orm.sales.findById(1)!;

    // Deep exact assertions on nested objects
    expect(found.Pricing).toEqual(input.Pricing);
    expect(found.Status).toEqual(input.Status);
    expect(found.HandledBy).toEqual(input.HandledBy);
    expect(found.Testing).toEqual(input.Testing);
    expect(found.Reference).toEqual(input.Reference);
    expect(found.Shipping).toEqual(input.Shipping);

    orm._close();
  });
});
