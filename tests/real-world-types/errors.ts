import { Type, type Static } from "typebox";
import { StrictObject } from "./common";

export const ErrorCodeSchema = Type.Union([
  Type.Literal("VALIDATION_ERROR"),
  Type.Literal("UNAUTHORIZED"),
  Type.Literal("FORBIDDEN"),
  Type.Literal("NOT_FOUND"),
  Type.Literal("CONFLICT"),
  Type.Literal("INTERNAL_ERROR"),
]);

export const ErrorDetailSchema = StrictObject({
  path: Type.String(),
  message: Type.String(),
  code: Type.Optional(Type.String()),
});

export const ApiErrorSchema = StrictObject({
  success: Type.Literal(false),
  code: ErrorCodeSchema,
  message: Type.String(),
  details: Type.Optional(Type.Array(ErrorDetailSchema)),
});

export const ApiSuccessEnvelopeSchema = StrictObject({
  success: Type.Literal(true),
  kind: Type.String(),
  data: Type.Unknown(),
});

export type ErrorCode = Static<typeof ErrorCodeSchema>;
export type ErrorDetail = Static<typeof ErrorDetailSchema>;
export type ApiError = Static<typeof ApiErrorSchema>;
export type ApiSuccessEnvelope = Static<typeof ApiSuccessEnvelopeSchema>;

export function createApiError(code: ErrorCode, message: string, details?: ErrorDetail[]): ApiError {
  return {
    success: false,
    code,
    message,
    ...(details ? { details } : {}),
  };
}
