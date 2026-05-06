import { Type } from "typebox";
import { ExchangeRateSchema } from "../domain";
import { StrictObject } from "../common";

export const ExchangeRateListResultSchema = Type.Array(ExchangeRateSchema);

export const ExchangeRateSuccessResponseSchema = StrictObject({
  error: Type.Null(),
  result: ExchangeRateListResultSchema,
  success: Type.Boolean(),
});

export const ExchangeRateFailureResponseSchema = StrictObject({
  error: Type.String(),
  result: Type.Null(),
  success: Type.Boolean(),
});

export const ExchangeRateQuerySchema = StrictObject({
  currencies: Type.Optional(Type.String()),
});

export const ExchangeRateClosestQuerySchema = StrictObject({
  currencies: Type.Optional(Type.String()),
  date: Type.Optional(Type.String()),
});

export const ExchangeRateConvertQuerySchema = StrictObject({
  from: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
  amount: Type.String(),
});
