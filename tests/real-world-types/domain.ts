import { Type, type Static } from "typebox";
import { DateValueSchema, NullableNumberSchema, NullableStringSchema, StrictObject } from "./common";
import { LogEntrySchema } from "./log";

export enum TrackingType {
  UNDEFINED = 0,
  UPS = 1,
  FedEx = 2,
  DHL = 3,
  TNT = 4,
  PostDK = 5,
  GLS = 6,
  Posti = 7,
  BW = 8,
  CCAR = 9,
  Collect = 10,
  Other = 11,
  Interf = 12,
  DSV = 13,
}

export enum OrderPhase {
  CREATED = 0,
  QUOTE = 1,
  ACTIVE = 2,
  FINISHED = 3,
}

export enum SalesPhase {
  NOT_SET,
  CONFIRMED,
  PNP,
  TECH,
  PACKAGED,
  DISPATCHED,
  WAITING,
  DONE,
}

export const RMA_GROUPS = ["RMA", "RMA_PM", "TECHRMA", "RMA_STOCK", "FEJLPLUK", "FEJLPLUK", "EFTERSEND"];

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
  CustomerName: Type.String(),
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

export const InvoiceSchema = StrictObject({
  RowNumber: Type.Number(),
  LastChanged: DateValueSchema,
  BudgetCode: Type.Union([NullableStringSchema, NullableNumberSchema]),
  Account: Type.Number(),
  Department: NullableStringSchema,
  Date: DateValueSchema,
  InvoiceNumber: Type.Number(),
  Voucher: NullableStringSchema,
  Text: NullableStringSchema,
  TransactionType: Type.Number(),
  AmountMST: Type.Number(),
  AmountCur: Type.Number(),
  Currency: NullableStringSchema,
  Vat: Type.Union([NullableStringSchema, NullableNumberSchema]),
  VatAmount: Type.Number(),
  Approved: Type.Boolean(),
  ApprovedBy: NullableStringSchema,
  CashDiscountAmount: Type.Number(),
  CashDiscountDate: Type.Union([DateValueSchema, Type.Null()]),
  DueDate: Type.Union([DateValueSchema, Type.Null()]),
  Open: Type.Boolean(),
  ExchangeRate: Type.Number(),
  Reserved2: NullableNumberSchema,
  Reserved3: NullableNumberSchema,
  PostedDiffAmount: Type.Number(),
  RefRecId: NullableNumberSchema,
  Transaction: Type.Number(),
  ReminderCode: NullableNumberSchema,
  CashDiscount: NullableNumberSchema,
  RemindedDate: Type.Union([DateValueSchema, Type.Null()]),
  ExchangeRateTri: Type.Number(),
  PaymentId: NullableStringSchema,
  Centre: NullableStringSchema,
  Purpose: NullableStringSchema,
  PaymentMode: NullableStringSchema,
  ReminderSent: Type.Boolean(),
});

const SalePricingSchema = StrictObject({
  TotalMargin: Type.Number(),
  TotalTurnover: Type.Number(),
  TotalCostPrice: Type.Number(),
  TotalMarginDKK: Type.Number(),
  TotalTurnoverDKK: Type.Number(),
  TotalCostPriceDKK: Type.Number(),
  Invoices: Type.Array(InvoiceSchema),
  VATNumber: NullableStringSchema,
  VATNumberType: NullableStringSchema,
  Currency: NullableStringSchema,
  EstimatedOrderExchangeRate: Type.Number(),
  PaymentTerms: NullableStringSchema,
});

const SaleStatusSchema = StrictObject({
  Blocked: Type.Boolean(),
  OrderPhase: Type.Number(),
  IsSalesPhase: Type.Number(),
  Group: Type.String(),
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

export const SaleLineItemSchema = StrictObject({
  OrderNumber: Type.Number(),
  LineNumber: Type.Number(),
  ItemNumber: NullableStringSchema,
  ItemName: NullableStringSchema,
  Location: NullableStringSchema,
  ManufacturerGroup: NullableStringSchema,
  Quantity: Type.Number(),
  Discount: Type.Number(),
  Price: Type.Number(),
  PriceDKK: Type.Number(),
  PriceAmount: Type.Number(),
  PriceAmountDKK: Type.Number(),
  CostPrice: Type.Number(),
  CostPriceAmount: Type.Number(),
  Margin: Type.Number(),
  DeliverNow: Type.Number(),
  CreatedDate: DateValueSchema,
  DeliveryDate: DateValueSchema,
  SerialNumber: NullableStringSchema,
  Delivered: Type.Number(),
  LastChanged: DateValueSchema,
});

export const SaleSchema = Type.Object({
  OrderNumber: Type.Number(),
  OrderTransaction: Type.Number(),
  InvoiceNumbers: Type.Array(Type.Number()),
  LastChanged: DateValueSchema,
  CreatedDate: DateValueSchema,
  DocumentDate: Type.Union([DateValueSchema, Type.String()]),
  DeliveryDate: DateValueSchema,
  Account: Type.Number(),
  InvoiceAccount: Type.Number(),
  SearchName: Type.String(),
  CustomerInfo: SaleCustomerInfoSchema,
  Pricing: SalePricingSchema,
  Shipping: ShippingSchema,
  Reference: ReferenceSchema,
  Status: SaleStatusSchema,
  HandledBy: SaleHandledBySchema,
  Testing: SaleTestingSchema,
  Logs: Type.Array(LogEntrySchema),
  SalesLineItems: Type.Optional(Type.Array(SaleLineItemSchema)),
});

export const ReadyToPickLineSchema = StrictObject({
  LineNumber: Type.Number(),
  LineText: Type.Union([Type.String(), Type.Null()]),
  LineItemNumber: Type.Union([Type.String(), Type.Null()]),
  AmountNeeded: Type.Number(),
  AmountWeHave: Type.Number(),
  AmountWeAreReceiving: Type.Number(),
  IncludeInInventoryUpload: Type.Boolean(),
  OrderNumber: Type.Union([Type.String(), Type.Null()]),
  ExpectedDeliveryDate: Type.Union([DateValueSchema, Type.Null()]),
  ReadyToPick: Type.Boolean(),
  ShouldIgnore: Type.Boolean(),
});

export const OpenSaleSchema = StrictObject({
  ...Type.Omit(SaleSchema, ["InvoiceNumbers"]).properties,
  InvoiceNumbers: Type.Optional(Type.Array(Type.Number())),
  ReadyToPick: StrictObject({
    EntireOrderReady: Type.Boolean(),
    Lines: Type.Array(ReadyToPickLineSchema),
  }),
});

const PurchaseCustomerAddressSchema = StrictObject({
  AddressField1: NullableStringSchema,
  AddressField2: NullableStringSchema,
  AddressField3: NullableStringSchema,
  State: NullableStringSchema,
  ZipCity: NullableStringSchema,
  Country: NullableStringSchema,
  Attention: NullableStringSchema,
});

const PurchaseCustomerContactSchema = StrictObject({
  Phone: NullableStringSchema,
  Fax: NullableStringSchema,
  Email: NullableStringSchema,
});

const PurchaseCustomerInfoSchema = StrictObject({
  CustomerName: Type.String(),
  CustomerSearchName: Type.String(),
  CustomerAddress: PurchaseCustomerAddressSchema,
  CustomerContact: PurchaseCustomerContactSchema,
});

const PurchasePricingSchema = StrictObject({
  InvoiceAmount: Type.Number(),
  InvoiceAmountDKK: Type.Number(),
  ProjectedSalesPriceAmount: Type.Number(),
  ProjectedSalesPriceAmountDKK: Type.Number(),
  ProjectedMargin: Type.Number(),
  VAT: NullableStringSchema,
  VATNumber: NullableStringSchema,
  IncludesVAT: Type.Boolean(),
  Currency: NullableStringSchema,
  ExchangeRate: Type.Number(),
  PaymentTerms: NullableStringSchema,
  TaxableAmount: Type.Number(),
  DiscountAmount: Type.Number(),
  VatAmount: Type.Number(),
  VatBase: Type.Number(),
  OrderBalance: Type.Number(),
});

const PurchaseShippingSchema = StrictObject({
  DeliveryTerms: NullableStringSchema,
  TrackingType: NullableNumberSchema,
  TrackingNumber: NullableStringSchema,
});

const PurchaseReferenceSchema = StrictObject({
  YourRef: NullableStringSchema,
  OurRef: NullableStringSchema,
  ReferenceNumber: NullableStringSchema,
});

const PurchaseStatusSchema = StrictObject({
  Blocked: Type.Boolean(),
  Approved: Type.Boolean(),
  IsPurchPhase: Type.Number(),
  Group: Type.Union([Type.String(), Type.Null()]),
  OrderStatus: Type.String(),
});

const PurchaseTestingSchema = StrictObject({
  TestedBy: NullableStringSchema,
  TestHours: Type.Number(),
  TestMinutes: Type.Number(),
});

const PurchaseHandledBySchema = StrictObject({
  PurchasedBy: NullableStringSchema,
  Bearer: NullableStringSchema,
  PutBy: NullableStringSchema,
  UnpackedBy: NullableStringSchema,
  BookedBy: NullableStringSchema,
});

export const PurchaseLineItemSchema = StrictObject({
  OrderNumber: Type.Number(),
  LineNumber: Type.Number(),
  ItemNumber: Type.String(),
  ItemName: NullableStringSchema,
  Location: NullableStringSchema,
  ManufacturerGroup: NullableStringSchema,
  Quantity: Type.Number(),
  Price: Type.Number(),
  PriceDKK: Type.Number(),
  Discount: Type.Number(),
  PriceAmount: Type.Number(),
  PriceAmountDKK: Type.Number(),
  ProjectedSalesPrice: Type.Number(),
  ProjectedSalesPriceDKK: Type.Number(),
  ProjectedSalesPriceAmount: Type.Number(),
  ProjectedSalesPriceAmountDKK: Type.Number(),
  ProjectedMargin: Type.Number(),
  ReceiveNow: Type.Number(),
  CreatedDate: DateValueSchema,
  DeliveryDate: DateValueSchema,
  Received: Type.Number(),
  SerialNumber: NullableStringSchema,
});

export const PurchaseSchema = StrictObject({
  OrderNumber: Type.Number(),
  PurchaseTransaction: Type.Number(),
  LastChanged: DateValueSchema,
  CreatedDate: DateValueSchema,
  DocumentDate: DateValueSchema,
  DeliveryDate: DateValueSchema,
  Account: Type.Number(),
  InvoiceAccount: Type.Number(),
  SalesNumber: NullableStringSchema,
  CustomerInfo: PurchaseCustomerInfoSchema,
  Pricing: PurchasePricingSchema,
  Shipping: PurchaseShippingSchema,
  Reference: PurchaseReferenceSchema,
  Status: PurchaseStatusSchema,
  Testing: PurchaseTestingSchema,
  HandledBy: PurchaseHandledBySchema,
  Logs: Type.Array(LogEntrySchema),
  PurchaseLineItems: Type.Optional(Type.Array(PurchaseLineItemSchema)),
  UsedInOrderNumbers: Type.Optional(Type.Array(Type.String())),
});

const CustomerContactDetailedSchema = StrictObject({
  Phone: NullableStringSchema,
  Fax: NullableStringSchema,
  Email: NullableStringSchema,
  CellPhone: NullableStringSchema,
  Website: NullableStringSchema,
});

const CustomerAddressDetailedSchema = StrictObject({
  AddressField1: NullableStringSchema,
  AddressField2: NullableStringSchema,
  AddressField3: NullableStringSchema,
  State: NullableStringSchema,
  ZipCity: NullableStringSchema,
  Country: NullableStringSchema,
  Attention: NullableStringSchema,
});

const CustomerInvoicingSchema = StrictObject({
  InvoiceAccount: Type.Number(),
  VAT: NullableStringSchema,
  VATNumber: NullableStringSchema,
  VATNumberType: NullableStringSchema,
  Currency: NullableStringSchema,
  PaymentTerms: NullableStringSchema,
  DeliveryTerms: NullableStringSchema,
  Balance: Type.Number(),
  DueAmount: Type.Number(),
});

const CustomerStatusSchema = StrictObject({
  Blocked: Type.Boolean(),
  Approved: Type.Boolean(),
  Group: Type.String(),
  TopListRank: Type.Number(),
});

const CustomerSalesInfoSchema = StrictObject({
  SalesRep: NullableStringSchema,
  PriceGroup: NullableStringSchema,
  DiscountGroup: NullableStringSchema,
  CashDiscount: NullableStringSchema,
  QuoteLinesYTD: Type.Number(),
  InvoiceLinesYTD: Type.Number(),
  YTDRank: Type.Number(),
  YTDTurnover: Type.Number(),
  YTDMargin: Type.Number(),
  Rating: Type.Number(),
});

export const CustomerSchema = StrictObject({
  CustomerNumber: Type.Number(),
  LastChanged: DateValueSchema,
  CustomerName: Type.String(),
  SearchName: Type.Union([Type.String(), Type.Null()]),
  CustomerAddress: CustomerAddressDetailedSchema,
  CustomerContact: CustomerContactDetailedSchema,
  Invoicing: CustomerInvoicingSchema,
  Status: CustomerStatusSchema,
  SalesInfo: CustomerSalesInfoSchema,
});

export const InventoryStockLevelSchema = StrictObject({
  Location: NullableStringSchema,
  Inventory: NullableNumberSchema,
  Reserved: NullableNumberSchema,
  Ordered: NullableNumberSchema,
  Delivered: NullableNumberSchema,
  Received: NullableNumberSchema,
  Minimum: NullableNumberSchema,
  Maximum: NullableNumberSchema,
  Placement: NullableStringSchema,
  LeadTime: Type.Number(),
  CoverageType: Type.Number(),
  Period: Type.Number(),
  PackingSize: Type.Number(),
  InventoryValue: Type.Number(),
  DeliveredValue: Type.Number(),
  ReceivedValue: Type.Number(),
  Pulled: Type.Number(),
  MarkedPhysical: Type.Number(),
  ProfitLoss: Type.Number(),
  LastChanged: Type.Union([DateValueSchema, Type.Null()]),
});

export const InventoryPriceSchema = StrictObject({
  Price: Type.Number(),
  PriceUnit: Type.Number(),
  Currency: NullableStringSchema,
  PriceGroup: NullableStringSchema,
  ContributionRatio: NullableNumberSchema,
  Date: Type.Union([DateValueSchema, Type.Null()]),
  SalesVAT: NullableStringSchema,
  LastChanged: Type.Union([DateValueSchema, Type.Null()]),
});

export const InventoryMovementSchema = StrictObject({
  Location: Type.Union([Type.String(), Type.Null()]),
  TransactionDate: DateValueSchema,
  QtyMoved: Type.Number(),
  Currency: Type.String(),
  Voucher: Type.String(),
  InvoiceNumber: NullableStringSchema,
  OrderNumber: NullableStringSchema,
  CustomerNumber: NullableStringSchema,
  Employee: NullableStringSchema,
  SerialNumber: NullableStringSchema,
  LineNumber: NullableNumberSchema,
  TransactionType: Type.Union([Type.Literal("Sale"), Type.Literal("Purchase"), Type.Literal("Other")]),
  TotalDKK: Type.Number(),
  LastChanged: DateValueSchema,
});

export const InventorySchema = StrictObject({
  ItemNumber: Type.String(),
  LastChanged: Type.Union([DateValueSchema, Type.Null()]),
  ItemName: Type.String(),
  ItemType: NullableNumberSchema,
  DiscountGroup: NullableStringSchema,
  CostCurrency: NullableStringSchema,
  CostPrice: NullableNumberSchema,
  Group: NullableStringSchema,
  SalesModel: NullableNumberSchema,
  CostingMethod: NullableNumberSchema,
  PurchaseSeriesSize: NullableNumberSchema,
  PrimaryVendor: NullableStringSchema,
  VendorItemNumber: NullableStringSchema,
  Blocked: Type.Boolean(),
  Alternative: Type.Boolean(),
  AlternativeItemNumber: NullableStringSchema,
  Decimals: NullableNumberSchema,
  Commission: NullableNumberSchema,
  ImageFile: NullableStringSchema,
  NetWeight: NullableNumberSchema,
  Volume: NullableNumberSchema,
  TariffNumber: NullableStringSchema,
  UnitCode: NullableStringSchema,
  OneTimeItem: Type.Boolean(),
  CostType: NullableStringSchema,
  ExtraCost: NullableNumberSchema,
  PurchaseCostModel: NullableNumberSchema,
  MainLocation: NullableStringSchema,
  InventoryLocation: NullableStringSchema,
  PurchaseVAT: NullableStringSchema,
  Inventory: Type.Union([Type.Number(), Type.Null()]),
  Delivered: NullableNumberSchema,
  Reserved: NullableNumberSchema,
  Received: NullableNumberSchema,
  Ordered: NullableNumberSchema,
  InventoryValue: NullableNumberSchema,
  DeliveredValue: NullableNumberSchema,
  ReceivedValue: NullableNumberSchema,
  Department: NullableStringSchema,
  CostPriceUnit: NullableNumberSchema,
  Level: NullableNumberSchema,
  Pulled: NullableNumberSchema,
  WarnNegativeInventory: Type.Boolean(),
  NegativeInventory: Type.Boolean(),
  IgnoreListCode: NullableNumberSchema,
  PaymentCType: NullableStringSchema,
  ItemTracking: NullableNumberSchema,
  ItemTrackGroup: NullableStringSchema,
  ProjectCostFactor: NullableNumberSchema,
  Centre: NullableStringSchema,
  Purpose: NullableStringSchema,
  SupplyFactor: NullableNumberSchema,
  SupplementaryUnits: NullableStringSchema,
  MarkedPhysical: NullableNumberSchema,
  LastMovementDate: Type.Union([DateValueSchema, Type.Null()]),
  VATGroup: NullableStringSchema,
  StandardItemNumber: NullableNumberSchema,
  FC: NullableStringSchema,
  ItemStatus: NullableNumberSchema,
  ExcludeInventoryUpload: Type.Boolean(),
  SalesPriceList: NullableStringSchema,
  DocFolderPath: NullableStringSchema,
  CRMQuoteLinesPeriod: NullableNumberSchema,
  CRMQuoteLinesYTD: NullableNumberSchema,
  CRMInvoiceLinesPeriod: NullableNumberSchema,
  CRMInvoiceLinesYTD: NullableNumberSchema,
  EAN: NullableStringSchema,
  Guarantee: NullableStringSchema,
  Available2: NullableNumberSchema,
  EbayID: NullableStringSchema,
  MinInventory: NullableNumberSchema,
  MaxInventory: NullableNumberSchema,
  SkipPrint: Type.Boolean(),
  WebMin: NullableNumberSchema,
  WebMax: NullableNumberSchema,
  StockMin: NullableNumberSchema,
  StockMax: NullableNumberSchema,
  COO: NullableStringSchema,
  CopyDanCode: NullableStringSchema,
  CO2Code: NullableNumberSchema,
  SubGroups: Type.Array(Type.String()),
  SubReferences: Type.Array(Type.String()),
  MXFields: Type.Array(Type.Number()),
  ItemPictures: Type.Array(Type.String()),
  StockLevels: Type.Array(InventoryStockLevelSchema),
  Pricing: Type.Array(InventoryPriceSchema),
  RecentMovements: Type.Array(InventoryMovementSchema),
});

export enum CurrencyCode {
  DKK = "DKK",
  EUR = "EUR",
  USD = "USD",
  GBP = "GBP",
  SEK = "SEK",
  NOK = "NOK",
  TRY = "TRY",
}

export { CurrencyCode as currencyCodes };

export const C5CurrencyMapSchema = StrictObject({
  CURRENCY: Type.Enum(CurrencyCode),
  EXCHRATE: Type.Number(),
  LASTCHANGED: Type.String(),
});

export const ExchangeRateSchema = StrictObject({
  currency: Type.String(),
  rate: Type.Number(),
});

export const ExchangeRateResponseSchema = StrictObject({
  success: Type.Boolean(),
  result: Type.Union([Type.Number(), Type.Array(ExchangeRateSchema), Type.Null()]),
  error: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const InventoryValueResultSchema = StrictObject({
  inventoryValue: Type.Number(),
  totalPurchasesValue: Type.Number(),
  totalPurchasesToInventoryValue: Type.Number(),
  totalPurchasesToOrderValue: Type.Number(),
  totalOrderValue: Type.Number(),
  dataset: Type.String(),
});

export const InventoryValueQuerySchema = StrictObject({
  dataset: Type.Optional(Type.String()),
});

export const InventoryValueSuccessResponseSchema = StrictObject({
  success: Type.Literal(true),
  result: InventoryValueResultSchema,
  error: Type.Null(),
});

export const InventoryValueFailureResponseSchema = StrictObject({
  success: Type.Literal(false),
  error: Type.String(),
  result: Type.Null(),
});

export type Sale = Static<typeof SaleSchema>;
export type OpenSale = Static<typeof OpenSaleSchema>;
export type Purchase = Static<typeof PurchaseSchema>;
export type Customer = Static<typeof CustomerSchema>;
export type Inventory = Static<typeof InventorySchema>;
export type SaleLineItem = Static<typeof SaleLineItemSchema>;
export type PurchaseLineItem = Static<typeof PurchaseLineItemSchema>;
export type Invoice = Static<typeof InvoiceSchema>;
export type ReadyToPickLine = Static<typeof ReadyToPickLineSchema>;
export type InventoryStockLevel = Static<typeof InventoryStockLevelSchema>;
export type InventoryPrice = Static<typeof InventoryPriceSchema>;
export type InventoryMovement = Static<typeof InventoryMovementSchema>;
export type C5CurrencyMap = Static<typeof C5CurrencyMapSchema>;
export type ExchangeRate = Static<typeof ExchangeRateSchema>;
export type ExchangeRateResponse = Static<typeof ExchangeRateResponseSchema>;
export type InventoryValueResult = Static<typeof InventoryValueResultSchema>;
export type InventoryValueQuery = Static<typeof InventoryValueQuerySchema>;
export type InventoryValueSuccessResponse = Static<typeof InventoryValueSuccessResponseSchema>;
export type InventoryValueFailureResponse = Static<typeof InventoryValueFailureResponseSchema>;

export interface CompanyStats {
  overview: {
    totalSales: number;
    totalPurchases: number;
    totalRMAs: number;
    totalCustomers: number;
    totalInventoryValue: number;
    estimatedTotalInventoryValue?: number;
    totalPurchasesValue: number;
    totalPurchasesToInventoryValue: number;
    totalPurchasesToOrderValue: number;
    totalOrderValue: number;
    today: { turnover: number; margin: number };
    yesterday: { turnover: number; margin: number };
  };
  salesByGroup: {
    PNP: { count: number; value: number; margin: number };
    TECH: { count: number; value: number; margin: number };
    ITAD: { count: number; value: number; margin: number };
    SERVICE: { count: number; value: number; margin: number };
    RENTAL: { count: number; value: number; margin: number };
    SHIPPING: { count: number; value: number; margin: number };
  };
  salesByChannel: Record<string, { count: number; value: number; margin: number }>;
  purchasesByGroup: {
    PNP: { count: number; value: number };
    TECH: { count: number; value: number };
    ITAD: { count: number; value: number };
    SERVICE: { count: number; value: number };
    RENTAL: { count: number; value: number };
    SHIPPING: { count: number; value: number };
  };
  topSellingItems: Array<{
    itemNumber: string;
    itemName: string;
    unitsSold: number;
    revenue: number;
    margin: number;
  }>;
  topRMAItems: Array<{
    itemNumber: string;
    itemName: string;
    rmaCount: number;
    rmaValue: number;
  }>;
  topCustomers: Array<{
    customerName: string;
    account: number;
    revenue: number;
    margin: number;
    orderCount: number;
  }>;
  productGroupStats: Array<{
    groupName: string;
    revenue: number;
    margin: number;
    itemsSold: number;
    inventoryValue: number;
    purchasesToInventoryValue?: number;
    purchasesToOrderValue?: number;
    purchasesTotalValue?: number;
    estimatedTotalInventoryValue?: number;
  }>;
}

export interface EmployeeRanklistData {
  EMPLOYEE: string;
  NUMBER_OF_ORDERS: number;
  TOTAL_SALES: number;
  TOTAL_MARGIN: number;
  MARGIN_PERCENTAGE: number;
  MARGIN_RANK: number;
  NUMBER_OF_PURCHASES?: number;
  TOTAL_PURCHASES_VALUE?: number;
}

export interface EmployeePublicInfo {
  id: string;
  name: string;
  email: string;
  image: string | null;
  initials: string;
  givenName: string | null;
  familyName: string | null;
  orgName: string | null;
  organizationId: string;
  telephone: string | null;
  jobTitle: string | null;
  teammembers: {
    teamId: string;
    role: string | null;
    team: {
      name: string;
      description: string | null;
      accentColor: string | null;
      icon: string | null;
    };
  }[];
  productGroups: {
    productGroupId: string;
    role: string | null;
    productGroup: {
      name: string;
      slug: string;
      friendlyName: string | null;
      description: string | null;
      manufacturerCodes: string[];
    };
  }[];
}

export interface EmployeePerformance extends EmployeeRanklistData {
  employeeData?: unknown;
  goals: {
    turnover: number;
    turnoverYTD: number;
    margin: number;
    marginYTD: number;
  };
  goalProgress: {
    turnoverProgress: number;
    turnoverProgressYTD: number;
    marginProgress: number;
    marginProgressYTD: number;
  };
  productGroups: string[];
  managedGroups: string[];
}

export interface ProductGroupPerformance {
  groupName: string;
  managers: string[];
  salesReps: string[];
  revenue: number;
  margin: number;
  marginPercentage: number;
  orderCount: number;
  topItems: {
    itemNumber: string;
    name: string;
    revenue: number;
    margin: number;
    quantity: number;
  }[];
  goals: {
    turnover: number;
    turnoverYTD: number;
    margin: number;
    marginYTD: number;
    inventoryValue: number;
  };
  goalProgress: {
    turnoverProgress: number;
    turnoverProgressYTD: number;
    marginProgress: number;
    marginProgressYTD: number;
    inventoryProgress: number;
  };
  inventoryValue: number;
  purchasesToInventoryValue?: number;
  purchasesToOrderValue?: number;
  purchasesTotalValue?: number;
  estimatedTotalInventoryValue?: number;
}

export interface LeadershipDashboardData {
  companyOverview: CompanyStats;
  employeePerformance: EmployeePerformance[];
  productGroupPerformance: ProductGroupPerformance[];
  topPerformers: {
    byRevenue: EmployeePerformance[];
    byMargin: EmployeePerformance[];
    byMarginPercentage: EmployeePerformance[];
    byOrderCount: EmployeePerformance[];
  };
  underPerformers: {
    byRevenue: EmployeePerformance[];
    byMargin: EmployeePerformance[];
    behindGoals: EmployeePerformance[];
  };
  insights: {
    totalEmployees: number;
    employeesWithGoals: number;
    employeesMeetingGoals: number;
    employeesMeetingGoalsYTD: number;
    averageMarginPercentage: number;
    totalProductGroups: number;
    productGroupsWithGoals: number;
    productGroupsMeetingGoals: number;
  };
  todaysData: {
    employees: EmployeePerformance[];
    openSales: OpenSale[];
    openPurchases: Purchase[];
  };
}

export function isOpenSale(value: Sale | OpenSale): value is OpenSale {
  return "ReadyToPick" in value;
}

export function isActiveSale(value: Sale | OpenSale): boolean {
  return value.Status.OrderPhase === OrderPhase.ACTIVE;
}

export function assertOpenSale(value: Sale | OpenSale, message = "Expected open sale payload"): asserts value is OpenSale {
  if (!isOpenSale(value)) {
    throw new Error(message);
  }
}

export function assertActiveSale(value: Sale | OpenSale, message = "Expected active sale"): asserts value is Sale | OpenSale {
  if (!isActiveSale(value)) {
    throw new Error(message);
  }
}

export function isSaleLineItemEmpty(item: SaleLineItem): boolean {
  return (
    (item.ItemNumber === null || item.ItemNumber === "") &&
    (item.ItemName === null || item.ItemName === "") &&
    item.Price === 0 &&
    item.PriceAmount === 0 &&
    item.PriceDKK === 0 &&
    item.PriceAmountDKK === 0 &&
    item.CostPrice === 0 &&
    item.CostPriceAmount === 0 &&
    item.Margin === 0
  );
}

export function filterNonEmptySaleLineItems(items: SaleLineItem[] | undefined): SaleLineItem[] {
  if (!items) {
    return [];
  }
  return items.filter((item) => !isSaleLineItemEmpty(item));
}
