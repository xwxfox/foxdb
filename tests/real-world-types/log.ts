import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import Schema from "typebox/schema";
import { DateValueSchema, StrictObject, StringKeyValueSchema, toDate, toNumber } from "./common";

export const LogTableSchema = Type.Object({
  ROWNUMBER: Type.Number(),
  LASTCHANGED: DateValueSchema,
  MODULE: Type.Number(),
  NUMBER_: Type.Number(),
  DATE_: DateValueSchema,
  TXT: Type.String(),
  TIME: Type.Number(),
  USER_: Type.Union([Type.String(), Type.Number()]),
}, { additionalProperties: true });

const compiledLogTable = Schema.Compile(LogTableSchema);

export enum LogEntryType {
  CREDIT_MAX_EXCEEDED = "CREDIT_MAX_EXCEEDED",
  ORDER_CREATED = "ORDER_CREATED",
  PICKING_SLIP = "PICKING_SLIP",
  DELIVERY_NOTE = "DELIVERY_NOTE",
  INVOICE = "INVOICE",
  CHECKLIST = "CHECKLIST",
  BLOCKING_STATUS_CHANGE = "BLOCKING_STATUS_CHANGE",
  VAT_VERIFICATION = "VAT_VERIFICATION",
  UNKNOWN = "UNKNOWN",
  ORDER_CONFIRMATION_PRINTED = "ORDER_CONFIRMATION_PRINTED",
}

export enum OrderStatus {
  PICKING_SLIP = "PICKING_SLIP",
  CHECKLIST = "CHECKLIST",
  DELIVERY_NOTE = "DELIVERY_NOTE",
  PARTIAL = "PARTIAL",
  PROCESSING = "PROCESSING",
  INVOICED = "INVOICED",
}

export type DocumentType = "INVOICE" | "PICKING_SLIP" | "DELIVERY_NOTE" | "CHECKLIST";
export type CreditMaxReason = "OVERDUE" | "ORDER_BALANCE" | "ORDER_BALANCE_WITH_OPEN";
export type MetaTag = "proforma" | string;

const BaseLogEntryProperties = {
  raw: Type.String(),
  timestamp: DateValueSchema,
  metadata: Type.Array(StringKeyValueSchema),
  metatags: Type.Array(Type.String()),
};

const CreditMaxExceededEntrySchema = StrictObject({
  ...BaseLogEntryProperties,
  type: Type.Literal(LogEntryType.CREDIT_MAX_EXCEEDED),
  creditMax: Type.Union([Type.Number(), Type.Null()]),
  exceededAmount: Type.Number(),
  reason: Type.Union([Type.String(), Type.Null()]),
  normalizedReason: Type.Union([
    Type.Union([
      Type.Literal("OVERDUE"),
      Type.Literal("ORDER_BALANCE"),
      Type.Literal("ORDER_BALANCE_WITH_OPEN"),
    ]),
    Type.Null(),
  ]),
});

const DocumentEntrySchema = StrictObject({
  ...BaseLogEntryProperties,
  type: Type.Union([
    Type.Literal(LogEntryType.INVOICE),
    Type.Literal(LogEntryType.PICKING_SLIP),
    Type.Literal(LogEntryType.DELIVERY_NOTE),
    Type.Literal(LogEntryType.CHECKLIST),
  ]),
  documentNumber: Type.Optional(Type.String()),
});

const OrderCreatedEntrySchema = StrictObject({
  ...BaseLogEntryProperties,
  type: Type.Literal(LogEntryType.ORDER_CREATED),
});

const BlockingStatusChangeEntrySchema = StrictObject({
  ...BaseLogEntryProperties,
  type: Type.Literal(LogEntryType.BLOCKING_STATUS_CHANGE),
  from: Type.Boolean(),
  to: Type.Boolean(),
});

const VatVerificationEntrySchema = StrictObject({
  ...BaseLogEntryProperties,
  type: Type.Literal(LogEntryType.VAT_VERIFICATION),
  vatNumber: Type.String(),
  orderNumber: Type.String(),
  valid: Type.Boolean(),
});

const UnknownEntrySchema = StrictObject({
  ...BaseLogEntryProperties,
  type: Type.Literal(LogEntryType.UNKNOWN),
});

const OrderConfirmationPrintedEntrySchema = StrictObject({
  ...BaseLogEntryProperties,
  type: Type.Literal(LogEntryType.ORDER_CONFIRMATION_PRINTED),
  documentNumber: Type.Optional(Type.String()),
});

export const LogEntrySchema = Type.Union([
  CreditMaxExceededEntrySchema,
  DocumentEntrySchema,
  OrderCreatedEntrySchema,
  BlockingStatusChangeEntrySchema,
  VatVerificationEntrySchema,
  UnknownEntrySchema,
  OrderConfirmationPrintedEntrySchema,
]);

export const CreditMaxExceededEntry = CreditMaxExceededEntrySchema;
export const DocumentEntry = DocumentEntrySchema;
export const OrderCreatedEntry = OrderCreatedEntrySchema;
export const BlockingStatusChangeEntry = BlockingStatusChangeEntrySchema;
export const VatVerificationEntry = VatVerificationEntrySchema;
export const UnknownEntry = UnknownEntrySchema;
export const OrderConfirmationPrintedEntry = OrderConfirmationPrintedEntrySchema;

export type LogTable = Static<typeof LogTableSchema>;
export type LogEntry = Static<typeof LogEntrySchema>;

export function parseLogTable(input: unknown): LogTable {
  const converted = Value.Convert(LogTableSchema, Value.Clean(LogTableSchema, input)) as Partial<LogTable>;
  const normalized: LogTable = {
    ROWNUMBER: toNumber(converted.ROWNUMBER as number | string),
    LASTCHANGED: toDate(converted.LASTCHANGED as string | Date),
    MODULE: toNumber(converted.MODULE as number | string),
    NUMBER_: toNumber(converted.NUMBER_ as number | string),
    DATE_: toDate(converted.DATE_ as string | Date),
    TXT: String(converted.TXT ?? ""),
    TIME: toNumber(converted.TIME as number | string),
    USER_:
      typeof converted.USER_ === "number"
        ? String(converted.USER_)
        : String(converted.USER_ ?? ""),
  };

  if (!compiledLogTable.Check(normalized)) {
    const [, errors] = compiledLogTable.Errors(normalized);
    const firstError = errors[0];
    throw new Error(firstError ? `${firstError.instancePath || "/"} ${firstError.message}` : "Invalid log table row");
  }

  return normalized;
}
