import type { TSchema } from "typebox";
import type {
  FilterableFields,
  FilterableFieldsBase,
  FilterableForInclude,
  FieldType,
  ArrayFilterableFields,
  ArrayItemType,
  OrderableFields,
  DistinctableFields,
  SelectableKeys,
  SubTableKeys,
} from "./types.ts";
import type { SQLQueryBindings } from "./database.ts";
import type { FilterShape, WhereResult } from "./query-builder.ts";
import { buildFilter, buildWhere, buildOrderBy, buildLimitOffset } from "./query-builder.ts";
import type { TableMeta } from "./schema.ts";
import { feature } from "bun:bundle";
import { traceBegin, traceEnd } from "./tracing.ts";

// --- Condition node types -----------------------------------------------------

export type ConditionNode = {
  type: "condition";
  field: string;
  filter: FilterShape;
} | {
  type: "raw";
  sql: string;
  params: SQLQueryBindings[];
} | {
  type: "and";
  children: ConditionNode[];
} | {
  type: "or";
  children: ConditionNode[];
} | {
  type: "not";
  child: ConditionNode;
} | {
  type: "nested";
  field: string;
  children: ConditionNode[];
};

// --- Internal builder state passed to executor --------------------------------

export interface InternalBuilderState {
  nodes: ConditionNode[];
  orderBy: Array<{ column: string; direction: "ASC" | "DESC" }>;
  limit: number | undefined;
  offset: number | undefined;
  select: string[] | undefined;
  include: string[] | undefined;
  includeDeleted: boolean;
  distinct: boolean;
  distinctOn: string[] | undefined;
}

export interface AggregateBuilderState {
  aggregations: Record<string, { op: string; field: string }>;
  groupBy: string[] | undefined;
  having: ConditionNode[];
  includeDeleted: boolean;
}

// --- Convert ConditionNode tree to SQL ----------------------------------------

function buildNodeSql(
  node: ConditionNode,
  meta: TableMeta | undefined
): { sql: string; params: SQLQueryBindings[] } {
  switch (node.type) {
    case "condition": {
      return buildFilter(node.field, node.filter, meta);
    }
    case "raw": {
      return { sql: node.sql, params: node.params };
    }
    case "and": {
      const results = node.children.map((n) => buildNodeSql(n, meta));
      const sql = results
        .map((r) => r.sql)
        .filter(Boolean)
        .join(" AND ");
      if (!sql) return { sql: "", params: [] };
      return { sql: `(${sql})`, params: results.flatMap((r) => r.params) };
    }
    case "or": {
      const results = node.children.map((n) => buildNodeSql(n, meta));
      const sql = results
        .map((r) => r.sql)
        .filter(Boolean)
        .join(" OR ");
      if (!sql) return { sql: "", params: [] };
      return { sql: `(${sql})`, params: results.flatMap((r) => r.params) };
    }
    case "not": {
      const result = buildNodeSql(node.child, meta);
      if (!result.sql) return { sql: "", params: [] };
      return { sql: `NOT (${result.sql})`, params: result.params };
    }
    case "nested": {
      const sub = meta?.subTables.find(st => st.fieldName === node.field);
      if (!sub || !meta?.primaryKey) {
        throw new Error(
          `nested() filter on "${node.field}": field is not an object-array sub-table`
        );
      }
      const childParts = node.children
        .map(n => buildNodeSql(n, meta))
        .filter(r => r.sql);
      if (childParts.length === 0) return { sql: "", params: [] };
      const conditions = childParts.map(r => r.sql).join(" AND ");
      const params = childParts.flatMap(r => r.params);
      return {
        sql: `EXISTS (SELECT 1 FROM "${sub.tableName}" WHERE "_owner_id" = "${meta.tableName}"."${meta.primaryKey}" AND ${conditions})`,
        params,
      };
    }
  }
}

export function buildWhereFromNodes(
  nodes: ConditionNode[],
  softDeleteColumn: string | undefined,
  meta: TableMeta | undefined
): WhereResult {
  if (feature("DEBUG_TRACING")) traceBegin("fb.buildWhereFromNodes");
  const parts: Array<{ sql: string; params: SQLQueryBindings[] }> = [];

  if (softDeleteColumn) {
    parts.push({ sql: `"${softDeleteColumn}" IS NULL`, params: [] });
  }

  for (const node of nodes) {
    const result = buildNodeSql(node, meta);
    if (result.sql) {
      parts.push(result);
    }
  }

  if (parts.length === 0) {
    if (feature("DEBUG_TRACING")) traceEnd();
    return { sql: "", params: [] };
  }

  if (feature("DEBUG_TRACING")) traceEnd();
  return {
    sql: `WHERE ${parts.map((p) => p.sql).join(" AND ")}`,
    params: parts.flatMap((p) => p.params),
  };
}

// --- FilterBuilder ------------------------------------------------------------

export class FilterBuilder<
  TQuery extends TSchema & { properties: Record<string, TSchema> },
  TResult,
  I extends SubTableKeys<TQuery> | undefined = undefined
> {
  _nodes: ConditionNode[] = [];
  private _orderByFields: Array<{ column: string; direction: "ASC" | "DESC" }> = [];
  private _limitValue: number | undefined;
  private _offsetValue: number | undefined;
  private _selectFields: string[] | undefined;
  private _includeFields: string[] | undefined;
  private _includeDeletedValue: boolean = false;
  private _distinctValue: boolean = false;
  private _distinctOnFields: string[] | undefined;

  constructor(
    private _executor?: (state: InternalBuilderState) => TResult,
    private _asyncExecutor?: (state: InternalBuilderState) => Promise<TResult>
  ) { }

  private _assertExecutor(): (state: InternalBuilderState) => TResult {
    if (!this._executor) {
      throw new Error("FilterBuilder has no executor - cannot exec() on a logical-group-only builder");
    }
    return this._executor;
  }

  private _collectState(): InternalBuilderState {
    return {
      nodes: this._nodes,
      orderBy: this._orderByFields,
      limit: this._limitValue,
      offset: this._offsetValue,
      select: this._selectFields,
      include: this._includeFields,
      includeDeleted: this._includeDeletedValue,
      distinct: this._distinctValue,
      distinctOn: this._distinctOnFields,
    };
  }

  // --- Equality operators ---------------------------------------------------

  equals<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    value: FieldType<TQuery, P>
  ): this {
    this._nodes.push({ type: "condition", field, filter: { eq: value } satisfies FilterShape });
    return this;
  }

  notEquals<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    value: FieldType<TQuery, P>
  ): this {
    this._nodes.push({ type: "condition", field, filter: { ne: value } satisfies FilterShape });
    return this;
  }

  // --- Comparison operators ------------------------------------------------

  greaterThan<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    value: FieldType<TQuery, P>
  ): this {
    this._nodes.push({ type: "condition", field, filter: { gt: value } satisfies FilterShape });
    return this;
  }

  greaterThanOrEqual<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    value: FieldType<TQuery, P>
  ): this {
    this._nodes.push({ type: "condition", field, filter: { gte: value } satisfies FilterShape });
    return this;
  }

  lessThan<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    value: FieldType<TQuery, P>
  ): this {
    this._nodes.push({ type: "condition", field, filter: { lt: value } satisfies FilterShape });
    return this;
  }

  lessThanOrEqual<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    value: FieldType<TQuery, P>
  ): this {
    this._nodes.push({ type: "condition", field, filter: { lte: value } satisfies FilterShape });
    return this;
  }

  // --- Range --------------------------------------------------------------

  between<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    min: FieldType<TQuery, P>,
    max: FieldType<TQuery, P>
  ): this {
    this._nodes.push({
      type: "condition",
      field,
      filter: { between: [min, max] } satisfies FilterShape,
    });
    return this;
  }

  // --- String pattern matching --------------------------------------------

  like<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    pattern: string
  ): this {
    this._nodes.push({ type: "condition", field, filter: { like: pattern } satisfies FilterShape });
    return this;
  }

  contains<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    substring: string
  ): this {
    this._nodes.push({
      type: "condition",
      field,
      filter: { like: `%${substring}%` } satisfies FilterShape,
    });
    return this;
  }

  startsWith<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    prefix: string
  ): this {
    this._nodes.push({
      type: "condition",
      field,
      filter: { like: `${prefix}%` } satisfies FilterShape,
    });
    return this;
  }

  endsWith<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    suffix: string
  ): this {
    this._nodes.push({
      type: "condition",
      field,
      filter: { like: `%${suffix}` } satisfies FilterShape,
    });
    return this;
  }

  // --- Set operators ------------------------------------------------------

  in<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    values: FieldType<TQuery, P>[]
  ): this {
    this._nodes.push({ type: "condition", field, filter: { in: values } satisfies FilterShape });
    return this;
  }

  notIn<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    values: FieldType<TQuery, P>[]
  ): this {
    this._nodes.push({ type: "condition", field, filter: { notIn: values } satisfies FilterShape });
    return this;
  }

  // --- Null operators -----------------------------------------------------

  isNull<P extends FilterableForInclude<TQuery, I>>(field: P): this {
    this._nodes.push({ type: "condition", field, filter: { isNull: true } satisfies FilterShape });
    return this;
  }

  isNotNull<P extends FilterableForInclude<TQuery, I>>(field: P): this {
    this._nodes.push({
      type: "condition",
      field,
      filter: { isNotNull: true } satisfies FilterShape,
    });
    return this;
  }

  // --- Array operators ----------------------------------------------------

  arraySome<P extends ArrayFilterableFields<TQuery>>(
    field: P,
    value: ArrayItemType<TQuery, P>
  ): this {
    this._nodes.push({
      type: "condition",
      field,
      filter: { arraySome: value } satisfies FilterShape,
    });
    return this;
  }

  arrayNone<P extends ArrayFilterableFields<TQuery>>(
    field: P,
    value: ArrayItemType<TQuery, P>
  ): this {
    this._nodes.push({
      type: "condition",
      field,
      filter: { arrayNot: value } satisfies FilterShape,
    });
    return this;
  }

  isEmpty<P extends ArrayFilterableFields<TQuery>>(field: P): this {
    this._nodes.push({
      type: "condition",
      field,
      filter: { isEmpty: true } satisfies FilterShape,
    });
    return this;
  }

  isNotEmpty<P extends ArrayFilterableFields<TQuery>>(field: P): this {
    this._nodes.push({
      type: "condition",
      field,
      filter: { isEmpty: false } satisfies FilterShape,
    });
    return this;
  }

  // --- Stubbed future array methods ---------------------------------------

  arrayEvery<P extends ArrayFilterableFields<TQuery>>(
    _field: P,
    _value: ArrayItemType<TQuery, P>
  ): this {
    throw new Error(
      "arrayEvery is not yet implemented. Use arrayNone with negation or filter in application code."
    );
  }

  arrayContainsAll<P extends ArrayFilterableFields<TQuery>>(
    _field: P,
    _values: ArrayItemType<TQuery, P>[]
  ): this {
    throw new Error(
      "arrayContainsAll is not yet implemented. Use multiple arraySome calls with AND."
    );
  }

  arrayLength<P extends ArrayFilterableFields<TQuery>>(
    _field: P,
    _op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte",
    _value: number
  ): this {
    throw new Error(
      "arrayLength is not yet implemented."
    );
  }

  nested<P extends FilterableForInclude<TQuery, I>>(
    field: P,
    callback: (q: FilterBuilder<TQuery, unknown>) => void
  ): this {
    const child = new FilterBuilder<TQuery, unknown>();
    callback(child);
    if (child._nodes.length > 0) {
      this._nodes.push({ type: "nested", field, children: child._nodes });
    }
    return this;
  }

  // --- Logical grouping ---------------------------------------------------

  and(callback: (q: FilterBuilder<TQuery, unknown>) => void): this {
    const child = new FilterBuilder<TQuery, unknown>();
    callback(child);
    if (child._nodes.length > 0) {
      this._nodes.push({ type: "and", children: child._nodes });
    }
    return this;
  }

  or(callback: (q: FilterBuilder<TQuery, unknown>) => void): this {
    const child = new FilterBuilder<TQuery, unknown>();
    callback(child);
    if (child._nodes.length > 0) {
      this._nodes.push({ type: "or", children: child._nodes });
    }
    return this;
  }

  not(callback: (q: FilterBuilder<TQuery, unknown>) => void): this {
    const child = new FilterBuilder<TQuery, unknown>();
    callback(child);
    if (child._nodes.length > 0) {
      if (child._nodes.length === 1) {
        const single = child._nodes[0];
        if (single) {
          this._nodes.push({ type: "not", child: single });
        }
      } else {
        this._nodes.push({ type: "not", child: { type: "and", children: child._nodes } });
      }
    }
    return this;
  }

  // --- Raw SQL ------------------------------------------------------------

  raw(sql: string, params: SQLQueryBindings[] = []): this {
    this._nodes.push({ type: "raw", sql, params });
    return this;
  }

  // --- Ordering -----------------------------------------------------------

  orderBy<P extends OrderableFields<TQuery>>(
    field: P,
    direction: "ASC" | "DESC" = "ASC"
  ): this {
    this._orderByFields = [{ column: field, direction }];
    return this;
  }

  thenBy<P extends OrderableFields<TQuery>>(
    field: P,
    direction: "ASC" | "DESC" = "ASC"
  ): this {
    this._orderByFields.push({ column: field, direction });
    return this;
  }

  // --- Pagination ---------------------------------------------------------

  limit(n: number): this {
    this._limitValue = n;
    return this;
  }

  offset(n: number): this {
    this._offsetValue = n;
    return this;
  }

  // --- Projection ---------------------------------------------------------

  select<S extends SelectableKeys<TQuery>[]>(...fields: S): this {
    this._selectFields = fields;
    return this;
  }

  include<Inc extends SubTableKeys<TQuery>[]>(...relations: Inc): FilterBuilder<TQuery, TResult, Inc[number]> {
    this._includeFields = relations;
    return this as unknown as FilterBuilder<TQuery, TResult, Inc[number]>;
  }

  // --- Distinct -----------------------------------------------------------

  distinct(): this {
    this._distinctValue = true;
    return this;
  }

  distinctOn<D extends DistinctableFields<TQuery>[]>(...fields: D): this {
    this._distinctOnFields = fields;
    this._distinctValue = true;
    return this;
  }

  // --- Soft delete --------------------------------------------------------

  includeDeleted(): this {
    this._includeDeletedValue = true;
    return this;
  }

  // --- Execution ----------------------------------------------------------

  exec(): TResult {
    return this._assertExecutor()(this._collectState());
  }

  execAsync(): Promise<TResult> {
    const state = this._collectState();
    if (this._asyncExecutor) {
      return this._asyncExecutor(state);
    }
    const executor = this._assertExecutor();
    return Promise.resolve().then(() => executor(state));
  }

  execThrowable(): TResult {
    const executor = this._assertExecutor();
    const result = executor(this._collectState());
    if (result == null) {
      throw new Error("No result found");
    }
    if (Array.isArray(result) && result.length === 0) {
      throw new Error("No results found");
    }
    return result;
  }
}

// --- AggregateBuilder ---------------------------------------------------------

export class AggregateBuilder<
  TQuery extends TSchema & { properties: Record<string, TSchema> }
> {
  private _aggregations: Record<string, { op: string; field: string }> = {};
  private _groupByFields: string[] | undefined;
  private _havingNodes: ConditionNode[] = [];
  private _whereNodes: ConditionNode[] = [];
  private _includeDeletedValue: boolean = false;

  constructor(
    private _executor: (state: AggregateBuilderState) => Record<string, unknown>[],
    private _asyncExecutor?: (state: AggregateBuilderState) => Promise<Record<string, unknown>[]>
  ) { }

  sum(field: string, alias: string): this {
    this._aggregations[alias] = { op: "sum", field };
    return this;
  }

  count(field: string, alias: string): this {
    this._aggregations[alias] = { op: "count", field };
    return this;
  }

  avg(field: string, alias: string): this {
    this._aggregations[alias] = { op: "avg", field };
    return this;
  }

  min(field: string, alias: string): this {
    this._aggregations[alias] = { op: "min", field };
    return this;
  }

  max(field: string, alias: string): this {
    this._aggregations[alias] = { op: "max", field };
    return this;
  }

  groupBy<G extends string[]>(...fields: G): this {
    this._groupByFields = fields;
    return this;
  }

  having(callback: (q: FilterBuilder<TQuery, unknown>) => void): this {
    const child = new FilterBuilder<TQuery, unknown>();
    callback(child);
    this._havingNodes = child._nodes;
    return this;
  }

  includeDeleted(): this {
    this._includeDeletedValue = true;
    return this;
  }

  exec(): Record<string, unknown>[] {
    return this._executor({
      aggregations: this._aggregations,
      groupBy: this._groupByFields,
      having: this._havingNodes,
      includeDeleted: this._includeDeletedValue,
    });
  }

  execAsync(): Promise<Record<string, unknown>[]> {
    const state = {
      aggregations: this._aggregations,
      groupBy: this._groupByFields,
      having: this._havingNodes,
      includeDeleted: this._includeDeletedValue,
    };
    if (this._asyncExecutor) {
      return this._asyncExecutor(state);
    }
    return Promise.resolve().then(() => this._executor(state));
  }
}
