import { Type } from "typebox";
import {
  CustomerSchema,
  SaleSchema,
} from "../domain";
import { StrictObject } from "../common";

export const ViewMetaSchema = StrictObject({
  hash: Type.String(),
  generatedAt: Type.String(),
  cacheHit: Type.Boolean(),
});

export const DateRangeInfoSchema = StrictObject({
  from: Type.String(),
  to: Type.String(),
  ytdFrom: Type.String(),
});

export const ViewerContextSchema = StrictObject({
  employeeId: Type.String(),
  initials: Type.String(),
  displayName: Type.String(),
  isTeamView: Type.Boolean(),
  teamId: Type.Optional(Type.String()),
});

export const ViewErrorResponseSchema = StrictObject({
  success: Type.Literal(false),
  error: Type.String(),
  code: Type.Optional(Type.String()),
});

export const SalesStatsSchema = StrictObject({
  orderCount: Type.Number(),
  totalRevenueDKK: Type.Number(),
  totalMarginDKK: Type.Number(),
  averageMarginPct: Type.Number(),
  totalItemsSold: Type.Number(),
  openOrderCount: Type.Number(),
  openOrderValueDKK: Type.Number(),
});

export const SalesStatusStatsSchema = StrictObject({
  count: Type.Number(),
  totalTurnoverDKK: Type.Number(),
  totalMarginDKK: Type.Number(),
  averageMarginPct: Type.Number(),
});

export const SalesTeamMemberStatsSchema = StrictObject({
  initials: Type.String(),
  displayName: Type.String(),
  revenueDKK: Type.Number(),
  marginDKK: Type.Number(),
  orderCount: Type.Number(),
  marginPct: Type.Number(),
});

export const SalesDashboardResponseSchema = StrictObject({
  meta: ViewMetaSchema,
  dateRange: DateRangeInfoSchema,
  stats: SalesStatsSchema,
  openStats: SalesStatusStatsSchema,
  archivedStats: SalesStatusStatsSchema,
  ytdStats: SalesStatsSchema,
  teamStats: Type.Optional(Type.Array(SalesTeamMemberStatsSchema)),
  viewer: ViewerContextSchema,
});

export const PurchasesStatsSchema = StrictObject({
  orderCount: Type.Number(),
  totalCostDKK: Type.Number(),
  projectedRevenueDKK: Type.Number(),
  projectedMarginDKK: Type.Number(),
  openOrderCount: Type.Number(),
  openOrderValueDKK: Type.Number(),
  missingTrackingCount: Type.Number(),
  overdueCount: Type.Number(),
});

export const PurchasesStatusStatsSchema = StrictObject({
  count: Type.Number(),
  projectedRevenueDKK: Type.Number(),
  projectedMarginDKK: Type.Number(),
  averageMarginPct: Type.Number(),
});

export const PurchasesTeamMemberStatsSchema = StrictObject({
  initials: Type.String(),
  displayName: Type.String(),
  costDKK: Type.Number(),
  orderCount: Type.Number(),
  openCount: Type.Number(),
});

export const PurchasesDashboardResponseSchema = StrictObject({
  meta: ViewMetaSchema,
  dateRange: DateRangeInfoSchema,
  stats: PurchasesStatsSchema,
  openStats: PurchasesStatusStatsSchema,
  archivedStats: PurchasesStatusStatsSchema,
  ytdStats: PurchasesStatsSchema,
  teamStats: Type.Optional(Type.Array(PurchasesTeamMemberStatsSchema)),
  viewer: ViewerContextSchema,
});

export const ReturnsStatsSchema = StrictObject({
  totalCount: Type.Number(),
  totalValueDKK: Type.Number(),
  totalCostDKK: Type.Number(),
  marginImpactDKK: Type.Number(),
  agingBuckets: StrictObject({
    recent: Type.Number(),
    week: Type.Number(),
    month: Type.Number(),
    overdue: Type.Number(),
  }),
});

export const ReturnsStatusBreakdownSchema = StrictObject({
  status: Type.String(),
  count: Type.Number(),
  valueDKK: Type.Number(),
});

export const ReturnsDashboardResponseSchema = StrictObject({
  meta: ViewMetaSchema,
  dateRange: DateRangeInfoSchema,
  stats: ReturnsStatsSchema,
  byStatus: Type.Array(ReturnsStatusBreakdownSchema),
  viewer: ViewerContextSchema,
});

export const InventoryStatsSchema = StrictObject({
  totalValueDKK: Type.Number(),
  totalUnits: Type.Number(),
  skuCount: Type.Number(),
  lowStockValueDKK: Type.Number(),
  lowStockCount: Type.Number(),
  snapshotAt: Type.Union([Type.String(), Type.Null()]),
});

export const InventoryCategoryBreakdownSchema = StrictObject({
  category: Type.String(),
  valueDKK: Type.Number(),
  units: Type.Number(),
  skuCount: Type.Number(),
});

export const InventoryDashboardResponseSchema = StrictObject({
  meta: ViewMetaSchema,
  stats: InventoryStatsSchema,
  byCategory: Type.Array(InventoryCategoryBreakdownSchema),
  viewer: ViewerContextSchema,
});

export const TeamOverviewStatsSchema = StrictObject({
  openSalesCount: Type.Number(),
  openPurchasesCount: Type.Number(),
  turnoverLast30Days: Type.Number(),
  marginLast30Days: Type.Number(),
  marginPercentageLast30Days: Type.Number(),
  turnoverYTD: Type.Optional(Type.Number()),
  marginYTD: Type.Optional(Type.Number()),
  marginPercentageYTD: Type.Optional(Type.Number()),
});

export const TeamCustomersStatsSchema = StrictObject({
  totalCustomers: Type.Number(),
  activeCustomers: Type.Number(),
  totalYTDTurnover: Type.Number(),
  totalYTDMargin: Type.Number(),
});

export const EmployeeOverviewDataSchema = StrictObject({
  openSalesCount: Type.Number(),
  openPurchasesCount: Type.Number(),
  turnoverLast30Days: Type.Number(),
  marginLast30Days: Type.Number(),
  marginPercentageLast30Days: Type.Number(),
  turnoverYTD: Type.Optional(Type.Number()),
  marginYTD: Type.Optional(Type.Number()),
  marginPercentageYTD: Type.Optional(Type.Number()),
  bestCustomersLast30Days: Type.Optional(Type.Array(Type.Unknown())),
  bestSalesLast30Days: Type.Optional(Type.Array(Type.Unknown())),
});

export const EmployeeCustomersDataSchema = StrictObject({
  customerCount: Type.Number(),
  ytdTurnover: Type.Number(),
  ytdMargin: Type.Number(),
  topCustomers: Type.Array(
    StrictObject({
      customerNumber: Type.Number(),
      name: Type.String(),
      ytdTurnover: Type.Number(),
      ytdMargin: Type.Number(),
    })
  ),
});

export const TeamDataBatchResponseSchema = StrictObject({
  meta: ViewMetaSchema,
  dateRange: DateRangeInfoSchema,
  sales: Type.Optional(
    StrictObject({
      aggregated: SalesStatsSchema,
      byEmployee: Type.Record(Type.String(), SalesStatsSchema),
    })
  ),
  purchases: Type.Optional(
    StrictObject({
      aggregated: PurchasesStatsSchema,
      byEmployee: Type.Record(Type.String(), PurchasesStatsSchema),
    })
  ),
  overview: Type.Optional(
    StrictObject({
      aggregated: TeamOverviewStatsSchema,
      byEmployee: Type.Record(Type.String(), EmployeeOverviewDataSchema),
    })
  ),
  customers: Type.Optional(
    StrictObject({
      aggregated: TeamCustomersStatsSchema,
      byEmployee: Type.Record(Type.String(), EmployeeCustomersDataSchema),
    })
  ),
});

export const GridDataResponseSchema = StrictObject({
  rowData: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  rowCount: Type.Number(),
  lastRow: Type.Number(),
});

export const LineItemsResponseSchema = StrictObject({
  lineItems: Type.Array(Type.Unknown()),
});

export const InventoryDetailResponseSchema = StrictObject({
  stockLevels: Type.Array(Type.Unknown()),
  pricing: Type.Array(Type.Unknown()),
  movements: Type.Array(Type.Unknown()),
});

export const InventoryStatsResponseSchema = StrictObject({
  totalItems: Type.Number(),
  totalValue: Type.Number(),
  activeItems: Type.Number(),
  blockedItems: Type.Number(),
  lowStockItems: Type.Number(),
  zeroStockItems: Type.Number(),
  generatedAt: Type.String(),
});

export const ForecastItemSchema = StrictObject({
  ItemNumber: Type.String(),
  ItemName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  VendorName: Type.String(),
  RemainingQuantity: Type.Number(),
  PendingValue: Type.Number(),
  PendingValueDKK: Type.Number(),
  WeekYear: Type.String(),
  EstimatedArrivalWeek: Type.String(),
  DaysUntilDelivery: Type.Number(),
  Location: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  ManufacturerGroup: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  OrderNumber: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
});

export const InventoryForecastResponseSchema = StrictObject({
  totalItems: Type.Number(),
  totalPendingValue: Type.Number(),
  totalPendingValueDKK: Type.Number(),
  averageDaysToDelivery: Type.Number(),
  itemsByLocation: Type.Record(Type.String(), Type.Number()),
  valueByWeek: Type.Record(Type.String(), Type.Number()),
  topVendors: Type.Array(
    StrictObject({
      vendor: Type.String(),
      value: Type.Number(),
      items: Type.Number(),
    })
  ),
  locationBreakdown: Type.Array(
    StrictObject({
      location: Type.String(),
      value: Type.Number(),
      items: Type.Number(),
    })
  ),
  items: Type.Array(ForecastItemSchema),
  pagination: StrictObject({
    total: Type.Number(),
    hasMore: Type.Boolean(),
  }),
});

export const OverviewDataResponseSchema = StrictObject({
  openSalesCount: Type.Number(),
  openPurchasesCount: Type.Number(),
  ordersDueToday: Type.Array(SaleSchema),
  turnoverLast30Days: Type.Number(),
  marginLast30Days: Type.Number(),
  marginPercentageLast30Days: Type.Number(),
  turnoverPrevious30Days: Type.Number(),
  marginPrevious30Days: Type.Number(),
  marginPercentagePrevious30Days: Type.Number(),
  turnoverLast30DaysLastYear: Type.Number(),
  marginLast30DaysLastYear: Type.Number(),
  marginPercentageLast30DaysLastYear: Type.Number(),
  bestSalesLast30Days: Type.Array(SaleSchema),
  bestCustomersLast30Days: Type.Array(CustomerSchema),
  turnoverYTD: Type.Optional(Type.Number()),
  marginYTD: Type.Optional(Type.Number()),
  marginPercentageYTD: Type.Optional(Type.Number()),
  bestSalesYTD: Type.Optional(Type.Array(SaleSchema)),
  bestCustomersYTD: Type.Optional(Type.Array(CustomerSchema)),
  turnoverGoalYear: Type.Optional(Type.Number()),
  marginGoalYear: Type.Optional(Type.Number()),
});
