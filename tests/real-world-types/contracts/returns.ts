import { Type } from "typebox";
import type { Static } from "typebox";
import { DateValueSchema } from "../common";
import { StrictObject } from "../common";
import { SaleSchema } from "../domain";

export const ReturnsResponseSchema = Type.Array(SaleSchema);
export type ReturnsResponse = Static<typeof ReturnsResponseSchema>;

export const ReturnsSummaryResponseSchema = StrictObject({
  dateRange: StrictObject({ from: Type.String(), to: Type.String() }),
  totalCount: Type.Number(),
  totals: StrictObject({
    turnoverDKK: Type.Number(),
    marginDKK: Type.Number(),
    costDKK: Type.Number(),
  }),
  agingBuckets: StrictObject({
    "0_7": Type.Number(),
    "8_14": Type.Number(),
    "15_30": Type.Number(),
    gt_30: Type.Number(),
  }),
  byStatusGroup: Type.Array(
    StrictObject({
      group: Type.String(),
      count: Type.Number(),
      valueDKK: Type.Number(),
    })
  ),
  byManufacturerGroup: Type.Array(
    StrictObject({
      group: Type.String(),
      count: Type.Number(),
      valueDKK: Type.Number(),
      units: Type.Number(),
    })
  ),
});

export const ReturnsDetailResponseSchema = StrictObject({
  orderNumber: Type.Number(),
  customerName: Type.String(),
  statusGroup: Type.String(),
  documentDate: Type.Union([DateValueSchema, Type.Null()]),
  ageDays: Type.Number(),
  turnoverDKK: Type.Number(),
  marginDKK: Type.Number(),
  costDKK: Type.Number(),
  manufacturerGroups: Type.Array(Type.String()),
  lines: Type.Array(
    StrictObject({
      itemNumber: Type.String(),
      itemName: Type.String(),
      manufacturerGroup: Type.String(),
      quantity: Type.Number(),
      priceDKK: Type.Number(),
      marginDKK: Type.Number(),
      costDKK: Type.Number(),
    })
  ),
});

const ReturnsListItemSchema = StrictObject({
  orderNumber: Type.Number(),
  customerName: Type.String(),
  statusGroup: Type.String(),
  documentDate: Type.Union([DateValueSchema, Type.Null()]),
  turnoverDKK: Type.Number(),
  marginDKK: Type.Number(),
  costDKK: Type.Number(),
  manufacturerGroups: Type.Array(Type.String()),
  items: Type.Number(),
});

export const ReturnsListResponseSchema = StrictObject({
  total: Type.Number(),
  items: Type.Array(ReturnsListItemSchema),
  hasMore: Type.Boolean(),
  dateRange: StrictObject({ from: Type.String(), to: Type.String() }),
});
