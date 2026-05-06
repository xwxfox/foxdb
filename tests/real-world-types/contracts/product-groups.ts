import { Type } from "typebox";
import {
  InventorySchema,
  InventoryValueFailureResponseSchema,
  InventoryValueSuccessResponseSchema,
  OpenSaleSchema,
  PurchaseSchema,
  SaleSchema,
} from "../domain";
import { EmployeeRecordSchema } from "./employees";
import { StrictObject } from "../common";

const ProductGroupGoalsSchema = StrictObject({
  turnover: Type.Number(),
  turnoverYTD: Type.Number(),
  margin: Type.Number(),
  marginYTD: Type.Number(),
  inventoryValue: Type.Number(),
});

export const ProductGroupItemSchema = StrictObject({
  name: Type.String(),
  friendlyName: Type.String(),
  description: Type.String(),
  ManufacturerGroups: Type.Array(Type.String()),
  goals: ProductGroupGoalsSchema,
});

export const ProductGroupsListResponseSchema = Type.Array(ProductGroupItemSchema);

export const ProductGroupEmployeesSuccessResponseSchema = StrictObject({
  error: Type.Null(),
  result: StrictObject({
    managers: Type.Array(EmployeeRecordSchema),
    salesReps: Type.Array(EmployeeRecordSchema),
  }),
  success: Type.Boolean(),
});

export const ProductGroupEmployeesErrorResponseSchema = StrictObject({
  error: Type.String(),
  result: Type.Null(),
  success: Type.Boolean(),
});

export const ProductGroupInventoryValueSuccessResponseSchema = StrictObject({
  error: Type.Null(),
  result: StrictObject({
    inventoryValue: Type.Number(),
  }),
  success: Type.Boolean(),
});

export const ProductGroupInventoryValueErrorResponseSchema = InventoryValueFailureResponseSchema;

const ProductGroupRoleSchema = Type.Union([
  Type.Literal("MEMBER"),
  Type.Literal("MANAGER"),
  Type.Literal("VIEWER"),
]);

export const ProductGroupDescriptorSchema = StrictObject({
  id: Type.String(),
  name: Type.String(),
  slug: Type.String(),
  friendlyName: Type.Union([Type.String(), Type.Null()]),
  description: Type.Union([Type.String(), Type.Null()]),
  manufacturerCodes: Type.Array(Type.String()),
  metadata: Type.Union([Type.Unknown(), Type.Null()]),
  teamId: Type.Union([Type.String(), Type.Null()]),
  goals: Type.Optional(
    Type.Union([
      StrictObject({ turnover: Type.Number(), margin: Type.Number(), inventory: Type.Number() }),
      Type.Null(),
    ])
  ),
});

export const MembershipSchema = StrictObject({
  canViewPeer: Type.Boolean(),
  role: ProductGroupRoleSchema,
});

export const ProductGroupEmployeeSummarySchema = StrictObject({
  canViewPeer: Type.Boolean(),
  displayName: Type.String(),
  email: Type.Union([Type.String(), Type.Null()]),
  employeeId: Type.String(),
  initials: Type.String(),
  jobTitle: Type.Union([Type.String(), Type.Null()]),
  membershipRole: ProductGroupRoleSchema,
});

export const AccessibleProductGroupsResponseSchema = StrictObject({
  count: Type.Number(),
  groups: Type.Array(
    StrictObject({
      descriptor: ProductGroupDescriptorSchema,
      membership: MembershipSchema,
    })
  ),
});

const SalesLineTotalsSchema = StrictObject({
  itemsSold: Type.Number(),
  marginDKK: Type.Number(),
  revenueDKK: Type.Number(),
});

const PurchaseLineTotalsSchema = StrictObject({
  lineCount: Type.Number(),
  projectedMarginDKK: Type.Number(),
  projectedTurnoverDKK: Type.Number(),
  purchaseCostDKK: Type.Number(),
});

const ProductGroupSalesRecordSchema = StrictObject({
  ...SaleSchema.properties,
  groupTotals: SalesLineTotalsSchema,
});

const ProductGroupPurchaseRecordSchema = StrictObject({
  ...PurchaseSchema.properties,
  groupTotals: PurchaseLineTotalsSchema,
});

const SalesSummarySchema = StrictObject({
  averageMarginPct: Type.Number(),
  orderCount: Type.Number(),
  rmaCount: Type.Number(),
  rmaValueDKK: Type.Number(),
  totalItemsSold: Type.Number(),
  totalMarginDKK: Type.Number(),
  totalRevenueDKK: Type.Number(),
});

const TopSellingItemSummarySchema = StrictObject({
  averageMarginPct: Type.Number(),
  itemName: Type.String(),
  itemNumber: Type.String(),
  marginDKK: Type.Number(),
  orderCount: Type.Number(),
  revenueDKK: Type.Number(),
  unitsSold: Type.Number(),
});

const IncomingInventoryItemSummarySchema = StrictObject({
  ...PurchaseSchema.properties.PurchaseLineItems.items.properties,
  Account: Type.Number(),
  Vendor: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const ProductGroupAnalyticsBundleSchema = StrictObject({
  dateRangeSummary: SalesSummarySchema,
  incomingInventory: Type.Array(IncomingInventoryItemSummarySchema),
  inventoryPurchaseEstimates: StrictObject({
    costOfGoodsDKK: Type.Number(),
    estimatedMarginDKK: Type.Number(),
    estimatedTurnoverDKK: Type.Number(),
  }),
  inventoryValueDKK: Type.Number(),
  inventorySnapshotAt: Type.Union([Type.String(), Type.Null()]),
  openPurchasesCount: Type.Number(),
  openPurchasesValueDKK: Type.Number(),
  openSalesCount: Type.Number(),
  openSalesValueDKK: Type.Number(),
  topSellingItems: Type.Array(TopSellingItemSummarySchema),
  teamPerformance: Type.Array(
    StrictObject({ marginDKK: Type.Number(), revenueDKK: Type.Number(), salesRep: Type.String() })
  ),
  yearToDateSummary: SalesSummarySchema,
});

export const ProductGroupDatasetResponseSchema = StrictObject({
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
        openPurchases: Type.Array(ProductGroupPurchaseRecordSchema),
        openSales: Type.Array(ProductGroupSalesRecordSchema),
        archivedSales: Type.Array(ProductGroupSalesRecordSchema),
        inventory: Type.Array(InventorySchema),
      }),
    })
  ),
  viewer: StrictObject({ employeeId: Type.String(), initials: Type.String(), displayName: Type.String() }),
});

export const ProductGroupSalesResponseSchema = Type.Array(SaleSchema);
export const ProductGroupOpenSalesResponseSchema = Type.Array(OpenSaleSchema);
export const ProductGroupPurchasesResponseSchema = Type.Array(PurchaseSchema);
export const ProductGroupOpenPurchasesResponseSchema = Type.Array(PurchaseSchema);
