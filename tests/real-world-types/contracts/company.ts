import { Type } from "typebox";
import { StrictObject } from "../common";

const SalesGroupEntrySchema = StrictObject({
  count: Type.Number(),
  value: Type.Number(),
  margin: Type.Number(),
});

const PurchaseGroupEntrySchema = StrictObject({
  count: Type.Number(),
  value: Type.Number(),
});

const DayStatsSchema = StrictObject({
  turnover: Type.Number(),
  margin: Type.Number(),
});

export const CompanyStatsSchema = StrictObject({
  overview: StrictObject({
    totalSales: Type.Number(),
    totalPurchases: Type.Number(),
    totalRMAs: Type.Number(),
    totalCustomers: Type.Number(),
    totalInventoryValue: Type.Number(),
    estimatedTotalInventoryValue: Type.Optional(Type.Number()),
    totalPurchasesValue: Type.Number(),
    totalPurchasesToInventoryValue: Type.Number(),
    totalPurchasesToOrderValue: Type.Number(),
    totalOrderValue: Type.Number(),
    today: DayStatsSchema,
    yesterday: DayStatsSchema,
  }),
  salesByGroup: StrictObject({
    PNP: SalesGroupEntrySchema,
    TECH: SalesGroupEntrySchema,
    ITAD: SalesGroupEntrySchema,
    SERVICE: SalesGroupEntrySchema,
    RENTAL: SalesGroupEntrySchema,
    SHIPPING: SalesGroupEntrySchema,
  }),
  salesByChannel: Type.Record(
    Type.String(),
    StrictObject({ count: Type.Number(), value: Type.Number(), margin: Type.Number() })
  ),
  purchasesByGroup: StrictObject({
    PNP: PurchaseGroupEntrySchema,
    TECH: PurchaseGroupEntrySchema,
    ITAD: PurchaseGroupEntrySchema,
    SERVICE: PurchaseGroupEntrySchema,
    RENTAL: PurchaseGroupEntrySchema,
    SHIPPING: PurchaseGroupEntrySchema,
  }),
  topSellingItems: Type.Array(
    StrictObject({
      itemNumber: Type.String(),
      itemName: Type.String(),
      unitsSold: Type.Number(),
      revenue: Type.Number(),
      margin: Type.Number(),
    })
  ),
  topRMAItems: Type.Array(
    StrictObject({
      itemNumber: Type.String(),
      itemName: Type.String(),
      rmaCount: Type.Number(),
      rmaValue: Type.Number(),
    })
  ),
  topCustomers: Type.Array(
    StrictObject({
      customerName: Type.String(),
      account: Type.Number(),
      revenue: Type.Number(),
      margin: Type.Number(),
      orderCount: Type.Number(),
    })
  ),
  productGroupStats: Type.Array(
    StrictObject({
      groupName: Type.String(),
      revenue: Type.Number(),
      margin: Type.Number(),
      itemsSold: Type.Number(),
      inventoryValue: Type.Number(),
      purchasesToInventoryValue: Type.Optional(Type.Number()),
      purchasesToOrderValue: Type.Optional(Type.Number()),
      purchasesTotalValue: Type.Optional(Type.Number()),
      estimatedTotalInventoryValue: Type.Optional(Type.Number()),
    })
  ),
});
