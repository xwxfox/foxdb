import { Type } from "typebox";
import { CustomerSchema } from "../domain";
import { StrictObject } from "../common";

export const PaginationSchema = StrictObject({
  total: Type.Number(),
  page: Type.Number(),
  limit: Type.Number(),
  totalPages: Type.Number(),
});

export const CustomersResponseSchema = StrictObject({
  data: Type.Array(CustomerSchema),
  pagination: PaginationSchema,
});
