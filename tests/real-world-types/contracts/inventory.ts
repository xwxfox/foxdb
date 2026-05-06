import { Type } from "typebox";
import { InventorySchema } from "../domain";
import { StrictObject } from "../common";

export const CachedInventoryResponseSchema = StrictObject({
  data: Type.Array(InventorySchema),
  pagination: StrictObject({
    total: Type.Number(),
    page: Type.Number(),
    limit: Type.Number(),
    totalPages: Type.Number(),
  }),
});
