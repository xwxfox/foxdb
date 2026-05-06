import { Type } from "typebox";
import {
  DateValueSchema,
  NullableNumberSchema,
  NullableStringSchema,
  StrictObject,
} from "../common";
import {
  ProductGroupAnalyticsBundleSchema,
  ProductGroupDescriptorSchema,
  ProductGroupEmployeeSummarySchema,
  MembershipSchema,
} from "./product-groups";

export const SlimSaleLineItemSchema = StrictObject({
  OrderNumber: Type.Number(),
  LineNumber: Type.Number(),
  ItemNumber: NullableStringSchema,
  ItemName: NullableStringSchema,
  Location: NullableStringSchema,
  ManufacturerGroup: NullableStringSchema,
  Quantity: Type.Number(),
  PriceAmountDKK: Type.Number(),
  Margin: Type.Number(),
  DeliveryDate: DateValueSchema,
});

export const SlimSaleCustomerInfoSchema = StrictObject({
  CustomerName: Type.String(),
});

export const SlimSaleHandledBySchema = StrictObject({
  SalesRep: NullableStringSchema,
});

export const SlimSalePricingSchema = StrictObject({
  TotalTurnoverDKK: Type.Number(),
  TotalMarginDKK: Type.Number(),
  TotalCostPriceDKK: Type.Number(),
});

export const SlimSalesLineTotalsSchema = StrictObject({
  itemsSold: Type.Number(),
  marginDKK: Type.Number(),
  revenueDKK: Type.Number(),
});

export const SlimProductGroupSalesRecordSchema = StrictObject({
  OrderNumber: Type.Number(),
  Account: Type.Number(),
  InvoiceAccount: Type.Number(),
  CreatedDate: DateValueSchema,
  DocumentDate: Type.Union([DateValueSchema, Type.String()]),
  CustomerInfo: SlimSaleCustomerInfoSchema,
  HandledBy: SlimSaleHandledBySchema,
  Pricing: SlimSalePricingSchema,
  SalesLineItems: Type.Optional(Type.Array(SlimSaleLineItemSchema)),
  groupTotals: SlimSalesLineTotalsSchema,
});

export const SlimPurchaseLineItemSchema = StrictObject({
  OrderNumber: Type.Number(),
  LineNumber: Type.Number(),
  ItemNumber: Type.String(),
  ItemName: NullableStringSchema,
  Location: NullableStringSchema,
  ManufacturerGroup: NullableStringSchema,
  Quantity: Type.Number(),
  PriceAmountDKK: Type.Number(),
  ProjectedSalesPriceAmountDKK: Type.Number(),
  ProjectedMargin: Type.Number(),
  DeliveryDate: DateValueSchema,
});

export const SlimPurchaseCustomerInfoSchema = StrictObject({
  CustomerName: Type.String(),
});

export const SlimPurchaseHandledBySchema = StrictObject({
  PurchasedBy: NullableStringSchema,
});

export const SlimPurchaseLineTotalsSchema = StrictObject({
  purchaseCostDKK: Type.Number(),
});

export const SlimProductGroupPurchaseRecordSchema = StrictObject({
  OrderNumber: Type.Number(),
  Account: Type.Number(),
  CreatedDate: DateValueSchema,
  CustomerInfo: SlimPurchaseCustomerInfoSchema,
  HandledBy: SlimPurchaseHandledBySchema,
  PurchaseLineItems: Type.Optional(Type.Array(SlimPurchaseLineItemSchema)),
  groupTotals: SlimPurchaseLineTotalsSchema,
});

export const SlimProductGroupDatasetResponseSchema = StrictObject({
  dateRange: StrictObject({ from: Type.String(), to: Type.String(), ytdFrom: Type.String() }),
  employeeFilter: Type.Union([Type.String(), Type.Null()]),
  generatedAt: Type.String(),
  groups: Type.Array(
    StrictObject({
      descriptor: ProductGroupDescriptorSchema,
      employees: StrictObject({
        all: Type.Array(ProductGroupEmployeeSummarySchema),
        managers: Type.Array(ProductGroupEmployeeSummarySchema),
        members: Type.Array(ProductGroupEmployeeSummarySchema),
      }),
      membership: MembershipSchema,
      analytics: ProductGroupAnalyticsBundleSchema,
      data: StrictObject({
        openPurchases: Type.Array(SlimProductGroupPurchaseRecordSchema),
        openSales: Type.Array(SlimProductGroupSalesRecordSchema),
        archivedSales: Type.Array(SlimProductGroupSalesRecordSchema),
      }),
    })
  ),
  viewer: StrictObject({ employeeId: Type.String(), initials: Type.String(), displayName: Type.String() }),
});
