/**
 * foxdb/src/fts.ts
 * SQLite FTS5 external-content full-text search: name/column resolution,
 * DDL, and in-transaction sync SQL builders.
 */
import { ColDecode, type TableMeta } from "./schema.ts";
import type { FTSConfig } from "./types.ts";
import { raise } from "./errors.ts";

export function ftsTableName(tableName: string): string {
  return `_foxdb_fts_${tableName}`;
}

export function resolveFtsColumns(meta: TableMeta, fts: FTSConfig): string[] {
  if (fts === true || (typeof fts === "object" && !fts.columns)) {
    const cols = meta.columns
      .filter((c) => !c.generated && c.sqlType === "TEXT" && (c.decode ?? ColDecode.Scalar) === ColDecode.Scalar)
      .map((c) => c.name);
    if (cols.length === 0) {
      raise("FTS_NO_TEXT_COLUMNS", `foxdb: table "${meta.tableName}" has fts enabled but no TEXT columns to index`, { table: meta.tableName });
    }
    return cols;
  }
  const names = fts.columns!.map((c) => c.name);
  for (const n of names) {
    if (!meta.columnByName.has(n)) {
      raise("FTS_INVALID_COLUMN", `foxdb: fts column "${n}" not found in table "${meta.tableName}"`, { table: meta.tableName, column: n });
    }
  }
  return names;
}

export function buildCreateFtsSQL(
  tableName: string,
  columns: string[],
  opts: { tokenizer?: string; prefix?: number[] }
): string {
  const ft = ftsTableName(tableName);
  const colDefs = columns.map((c) => `"${c}"`).join(", ");
  const parts = [colDefs, `content='${tableName}'`, `content_rowid='rowid'`];
  if (opts.tokenizer) parts.push(`tokenize='${opts.tokenizer.replace(/'/g, "''")}'`);
  if (opts.prefix && opts.prefix.length > 0) parts.push(`prefix='${opts.prefix.join(" ")}'`);
  return `CREATE VIRTUAL TABLE IF NOT EXISTS "${ft}" USING fts5(${parts.join(", ")})`;
}

export function buildFtsIndexInsert(
  tableName: string,
  pk: string,
  columns: string[],
  count: number,
  key: "pk" | "rowid" = "pk"
): { sql: string; placeholders: number } {
  const ft = ftsTableName(tableName);
  const cols = ["rowid", ...columns].map((c) => `"${c}"`).join(", ");
  const where = key === "rowid" ? `"rowid"` : `"${pk}"`;
  const ph = new Array(count).fill("?").join(", ");
  return {
    sql: `INSERT INTO "${ft}"(${cols}) SELECT ${cols} FROM "${tableName}" WHERE ${where} IN (${ph})`,
    placeholders: count,
  };
}

export function buildFtsDeleteCommand(
  tableName: string,
  pk: string,
  columns: string[],
  count: number,
  key: "pk" | "rowid" = "pk"
): { sql: string; placeholders: number } {
  const ft = ftsTableName(tableName);
  const colList = [`"${ft}"`, `"rowid"`, ...columns.map((c) => `"${c}"`)].join(", ");
  const selList = [`'delete'`, `"rowid"`, ...columns.map((c) => `"${c}"`)].join(", ");
  const where = key === "rowid" ? `"rowid"` : `"${pk}"`;
  const ph = new Array(count).fill("?").join(", ");
  return {
    sql: `INSERT INTO "${ft}"(${colList}) SELECT ${selList} FROM "${tableName}" WHERE ${where} IN (${ph})`,
    placeholders: count,
  };
}

export function buildFtsDeleteAllSQL(tableName: string): string {
  const ft = ftsTableName(tableName);
  return `INSERT INTO "${ft}"("${ft}") VALUES('delete-all')`;
}

export function buildFtsRebuildSQL(tableName: string): string {
  const ft = ftsTableName(tableName);
  return `INSERT INTO "${ft}"("${ft}") VALUES('rebuild')`;
}

/** Pre-built INSERT ... VALUES template for direct-bind (single-row). Returns the SQL only — bind rowid + column values as params. */
export function buildFtsInsertDirectSQL(tableName: string, columns: string[]): string {
  const ft = ftsTableName(tableName);
  const cols = ["rowid", ...columns].map((c) => `"${c}"`).join(", ");
  const phs = columns.map(() => "?").join(", ");
  return `INSERT INTO "${ft}"(${cols}) VALUES (?, ${phs})`;
}

/** Pre-built FTS5 'delete' command with direct-bound values (single-row). SQL only — bind rowid + column values as params. */
export function buildFtsDeleteDirectSQL(tableName: string, columns: string[]): string {
  const ft = ftsTableName(tableName);
  const colList = [`"${ft}"`, `"rowid"`, ...columns.map((c) => `"${c}"`)].join(", ");
  const phs = columns.map(() => "?").join(", ");
  return `INSERT INTO "${ft}"(${colList}) VALUES ('delete', ?, ${phs})`;
}

// --- FTS search SQL builder + chainable builder class --------------------------

import type { SQLQueryBindings } from "./database.ts";
import type { ConditionNode } from "./filter-builder.ts";
import { buildWhereFromNodes, FilterBuilder } from "./filter-builder.ts";
import type { TSchema } from "typebox";

export interface FtsSnippetSpec { field: string; open: string; close: string; ellipsis: string; tokens: number; }
export interface FtsHighlightSpec { field: string; open: string; close: string; }

export interface FtsSearchState {
  query: string;
  limit?: number;
  offset?: number;
  weightMap?: Record<string, number>;
  weights?: number[];
  snippets: FtsSnippetSpec[];
  highlights: FtsHighlightSpec[];
  includeDeleted: boolean;
  nodes: ConditionNode[];
}

export type FtsResult<E> = E & { _score: number; _snippet: Record<string, string>; _highlight: Record<string, string> };

export function buildFtsSearchSql(
  tableName: string,
  ftsColumns: string[],
  state: FtsSearchState,
  softDeleteColumn: string | undefined,
  meta: TableMeta
): { sql: string; params: SQLQueryBindings[]; snippetAliases: Array<{ field: string; alias: string }>; highlightAliases: Array<{ field: string; alias: string }> } {
  const ft = ftsTableName(tableName);
  const colIndex = new Map(ftsColumns.map((c, i) => [c, i]));

  let bm25 = `bm25("${ft}")`;
  if (state.weights && state.weights.length > 0) {
    const w = state.weights.map((n) => {
      if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("fts weight must be a finite number");
      return String(n);
    });
    bm25 = `bm25("${ft}", ${w.join(", ")})`;
  }

  const innerSelect: string[] = [`rowid AS "_rid"`, `${bm25} AS "_score"`];
  const innerParams: SQLQueryBindings[] = [];
  const snippetAliases: Array<{ field: string; alias: string }> = [];
  const highlightAliases: Array<{ field: string; alias: string }> = [];

  for (const sp of state.snippets) {
    const idx = colIndex.get(sp.field);
    if (idx === undefined) throw new Error(`fts snippet: "${sp.field}" is not an indexed column`);
    const alias = `_snip_${sp.field}`;
    innerSelect.push(`snippet("${ft}", ${idx}, ?, ?, ?, ?) AS "${alias}"`);
    innerParams.push(sp.open, sp.close, sp.ellipsis, sp.tokens);
    snippetAliases.push({ field: sp.field, alias });
  }
  for (const hp of state.highlights) {
    const idx = colIndex.get(hp.field);
    if (idx === undefined) throw new Error(`fts highlight: "${hp.field}" is not an indexed column`);
    const alias = `_hl_${hp.field}`;
    innerSelect.push(`highlight("${ft}", ${idx}, ?, ?) AS "${alias}"`);
    innerParams.push(hp.open, hp.close);
    highlightAliases.push({ field: hp.field, alias });
  }

  const where = buildWhereFromNodes(state.nodes, state.includeDeleted ? undefined : softDeleteColumn, meta);
  const outerWhere = where.sql ? ` ${where.sql}` : "";

  const outerSelect = [
    `"${tableName}".*`,
    `m."_score"`,
    ...snippetAliases.map((s) => `m."${s.alias}"`),
    ...highlightAliases.map((h) => `m."${h.alias}"`),
  ].join(", ");

  const limitParts: string[] = [];
  const limitParams: SQLQueryBindings[] = [];
  if (state.limit !== undefined) { limitParts.push("LIMIT ?"); limitParams.push(state.limit); }
  if (state.offset !== undefined) { limitParts.push("OFFSET ?"); limitParams.push(state.offset); }

  const sql = [
    `SELECT ${outerSelect}`,
    `FROM (SELECT ${innerSelect.join(", ")} FROM "${ft}" WHERE "${ft}" MATCH ?) m`,
    `JOIN "${tableName}" ON "${tableName}".rowid = m."_rid"`,
    outerWhere,
    `ORDER BY m."_score"`,
    limitParts.join(" "),
  ].filter(Boolean).join(" ");

  return {
    sql,
    params: [...innerParams, state.query, ...where.params, ...limitParams],
    snippetAliases,
    highlightAliases,
  };
}

export class FtsSearchBuilder<
  TQuery extends TSchema & { properties: Record<string, TSchema> },
  TEntity,
  FTS extends string
> {
  _state: FtsSearchState;
  constructor(
    query: string,
    private _exec: (state: FtsSearchState) => FtsResult<TEntity>[],
    private _execAsync?: (state: FtsSearchState) => Promise<FtsResult<TEntity>[]>
  ) {
    this._state = { query, snippets: [], highlights: [], includeDeleted: false, nodes: [] };
  }

  limit(n: number): this { this._state.limit = n; return this; }
  offset(n: number): this { this._state.offset = n; return this; }
  includeDeleted(): this { this._state.includeDeleted = true; return this; }

  weight(field: FTS, w: number): this {
    (this._state.weightMap ??= {})[field as string] = w;
    return this;
  }
  weights(map: Partial<Record<FTS, number>>): this {
    for (const [k, v] of Object.entries(map)) if (typeof v === "number") this.weight(k as FTS, v);
    return this;
  }

  snippet(field: FTS, opts?: { open?: string; close?: string; ellipsis?: string; tokens?: number }): this {
    this._state.snippets.push({ field: field as string, open: opts?.open ?? "<b>", close: opts?.close ?? "</b>", ellipsis: opts?.ellipsis ?? "…", tokens: opts?.tokens ?? 15 });
    return this;
  }
  highlight(field: FTS, opts?: { open?: string; close?: string }): this {
    this._state.highlights.push({ field: field as string, open: opts?.open ?? "[", close: opts?.close ?? "]" });
    return this;
  }

  where(cb: (q: FilterBuilder<TQuery, unknown>) => void): this {
    const child = new FilterBuilder<TQuery, unknown>();
    cb(child);
    for (const n of child._nodes) this._state.nodes.push(n);
    return this;
  }

  exec(): FtsResult<TEntity>[] { return this._exec(this._state); }
  execAsync(): Promise<FtsResult<TEntity>[]> {
    if (this._execAsync) return this._execAsync(this._state);
    return Promise.resolve().then(() => this._exec(this._state));
  }
}
