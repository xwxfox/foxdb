import { Type } from "typebox";
import { OpenSaleSchema, PurchaseSchema, SaleSchema } from "../domain";

export const CachedSalesQuerySchema = Type.Object({
  dateFrom: Type.Optional(Type.String()),
  dateTo: Type.Optional(Type.String()),
  employee: Type.Optional(Type.String()),
  sort: Type.Optional(Type.String()),
  sortOrder: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  vendor: Type.Optional(Type.String()),
  fields: Type.Optional(Type.String()),
});

export const CachedOpenSalesQuerySchema = Type.Object({
  employee: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  vendor: Type.Optional(Type.String()),
  dateFrom: Type.Optional(Type.String()),
  dateTo: Type.Optional(Type.String()),
});

export const CachedPurchasesQuerySchema = Type.Object({
  dateFrom: Type.Optional(Type.String()),
  dateTo: Type.Optional(Type.String()),
  employee: Type.Optional(Type.String()),
  sort: Type.Optional(Type.String()),
  sortOrder: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  vendor: Type.Optional(Type.String()),
  fields: Type.Optional(Type.String()),
});

export const CachedOpenPurchasesQuerySchema = Type.Object({
  employee: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  vendor: Type.Optional(Type.String()),
  dateFrom: Type.Optional(Type.String()),
  dateTo: Type.Optional(Type.String()),
});

export const CachedSalesResponseSchema = Type.Array(SaleSchema);
export const CachedOpenSalesResponseSchema = Type.Array(OpenSaleSchema);
export const CachedPurchasesResponseSchema = Type.Array(PurchaseSchema);
export const CachedOpenPurchasesResponseSchema = Type.Array(PurchaseSchema);

export const GenericErrorResponseSchema = Type.Object({ error: Type.String() });
