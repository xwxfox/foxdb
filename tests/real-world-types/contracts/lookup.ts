import { Type, type Static } from "typebox";
import { parseWithSchema } from "../common";

export const LookupEntitySchema = Type.Union([
  Type.Literal("sales"),
  Type.Literal("purchases"),
  Type.Literal("inventory"),
  Type.Literal("customers"),
]);

const SearchModeSchema = Type.Union([
  Type.Literal("auto"),
  Type.Literal("natural"),
  Type.Literal("strict"),
  Type.Literal("fuzzy"),
  Type.Literal("structured"),
]);

const StringOrNumberSchema = Type.Union([Type.String({ minLength: 1 }), Type.Number()]);
const BooleanLikeSchema = Type.Union([Type.Boolean(), Type.String({ minLength: 1 })]);

const SalesFiltersSchema = Type.Partial(
  Type.Object({
    employee: Type.String({ minLength: 1 }),
    orderId: Type.String({ minLength: 1 }),
    vendor: Type.String({ minLength: 1 }),
    statusGroup: Type.String({ minLength: 1 }),
    statusGroups: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    dateFrom: Type.String({ minLength: 1 }),
    dateTo: Type.String({ minLength: 1 }),
  })
);

const PurchasesFiltersSchema = Type.Partial(
  Type.Object({
    employee: Type.String({ minLength: 1 }),
    orderId: Type.String({ minLength: 1 }),
    vendor: Type.String({ minLength: 1 }),
    dateFrom: Type.String({ minLength: 1 }),
    dateTo: Type.String({ minLength: 1 }),
  })
);

const InventoryFiltersSchema = Type.Partial(
  Type.Object({
    searchTerm: Type.String({ minLength: 1 }),
    itemNumber: Type.String({ minLength: 1 }),
    itemName: Type.String({ minLength: 1 }),
    vendor: Type.String({ minLength: 1 }),
    blocked: BooleanLikeSchema,
    stockState: Type.Union([Type.Literal("in"), Type.Literal("out")]),
  })
);

const CustomersFiltersSchema = Type.Partial(
  Type.Object({
    searchTerm: Type.String({ minLength: 1 }),
    customerNumber: StringOrNumberSchema,
    customerName: Type.String({ minLength: 1 }),
    salesRep: Type.String({ minLength: 1 }),
  })
);

const FiltersSchema = Type.Object(
  {
    sales: Type.Optional(SalesFiltersSchema),
    purchases: Type.Optional(PurchasesFiltersSchema),
    inventory: Type.Optional(InventoryFiltersSchema),
    customers: Type.Optional(CustomersFiltersSchema),
  },
  { additionalProperties: false }
);

const StrictSalesSchema = Type.Partial(
  Type.Object({
    orderNumber: StringOrNumberSchema,
    account: StringOrNumberSchema,
    invoiceAccount: StringOrNumberSchema,
  })
);

const StrictPurchasesSchema = Type.Partial(
  Type.Object({
    orderNumber: StringOrNumberSchema,
    account: StringOrNumberSchema,
  })
);

const StrictInventorySchema = Type.Partial(
  Type.Object({
    itemNumber: StringOrNumberSchema,
    vendorItemNumber: StringOrNumberSchema,
    ean: StringOrNumberSchema,
  })
);

const StrictCustomersSchema = Type.Partial(
  Type.Object({
    customerNumber: StringOrNumberSchema,
    vatNumber: StringOrNumberSchema,
    searchName: Type.String({ minLength: 1 }),
  })
);

const StrictSchema = Type.Object(
  {
    sales: Type.Optional(StrictSalesSchema),
    purchases: Type.Optional(StrictPurchasesSchema),
    inventory: Type.Optional(StrictInventorySchema),
    customers: Type.Optional(StrictCustomersSchema),
  },
  { additionalProperties: false }
);

export const LookupSearchRequestSchema = Type.Object(
  {
    query: Type.Optional(Type.String({ minLength: 1 })),
    mode: Type.Optional(SearchModeSchema),
    entities: Type.Optional(Type.Array(LookupEntitySchema, { minItems: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    filters: Type.Optional(FiltersSchema),
    strict: Type.Optional(StrictSchema),
  },
  { additionalProperties: false }
);

export type LookupSearchRequest = Static<typeof LookupSearchRequestSchema>;
export type LookupEntity = Static<typeof LookupEntitySchema>;

type ParseIssue = { path: string; message: string };
type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = {
  success: false;
  error: {
    issues: ParseIssue[];
    flatten: () => { formErrors: string[]; fieldErrors: Record<string, string[]> };
  };
};
export type LookupSearchRequestParseResult = ParseSuccess<LookupSearchRequest> | ParseFailure;

function hasMeaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return true;
  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulValue(entry));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => hasMeaningfulValue(entry));
  }
  return String(value).trim().length > 0;
}

function issue(path: string, message: string): ParseFailure {
  const issues: ParseIssue[] = [{ path, message }];
  return {
    success: false,
    error: {
      issues,
      flatten: () => ({
        formErrors: issues.map((entry) => `${entry.path}: ${entry.message}`),
        fieldErrors: {},
      }),
    },
  };
}

export function parseLookupSearchRequest(input: unknown): LookupSearchRequestParseResult {
  const parsed = parseWithSchema(LookupSearchRequestSchema, input, "lookupSearchRequest");
  if (!parsed.ok) {
    return issue("/", parsed.error.message);
  }

  const value = parsed.value;
  const hasQuery = typeof value.query === "string" && value.query.trim().length > 0;
  const hasFilters = value.filters ? Object.values(value.filters).some((section) => hasMeaningfulValue(section)) : false;
  const hasStrict = value.strict ? Object.values(value.strict).some((section) => hasMeaningfulValue(section)) : false;

  if (!hasQuery && !hasFilters && !hasStrict) {
    return issue("/", "Provide a query, filters, or strict lookup constraints.");
  }

  return { success: true, data: value };
}

export interface LookupSearchResult {
  entity: LookupEntity;
  scope?: string;
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  score: number;
  strictMatch: boolean;
  matchedTerms: string[];
  updatedAt?: string;
  createdAt?: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface SearchLookupOptions {
  actorInitials?: string;
  profile?: boolean;
}
