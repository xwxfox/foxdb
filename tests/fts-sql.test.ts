import { describe, test, expect } from "bun:test";
import {
  ftsTableName,
  resolveFtsColumns,
  buildCreateFtsSQL,
  buildFtsIndexInsert,
  buildFtsDeleteCommand,
  buildFtsDeleteAllSQL,
  buildFtsRebuildSQL,
} from "../src/fts.ts";
import { introspectTable } from "../src/schema.ts";
import { Object, String, Integer } from "typebox";

const S = Object({ id: String(), title: String(), body: String(), views: Integer() });
const meta = introspectTable("docs", S, undefined, "id");

describe("fts sql builders", () => {
  test("ftsTableName", () => {
    expect(ftsTableName("docs")).toBe("_foxdb_fts_docs");
  });

  test("resolveFtsColumns(true) picks TEXT scalar columns only", () => {
    const cols = resolveFtsColumns(meta, true);
    expect(cols.sort()).toEqual(["body", "title"]);
  });

  test("resolveFtsColumns with explicit list", () => {
    const cols = resolveFtsColumns(meta, { columns: [{ name: "title" } as any] });
    expect(cols).toEqual(["title"]);
  });

  test("resolveFtsColumns throws for unknown explicit column", () => {
    expect(() => resolveFtsColumns(meta, { columns: [{ name: "nope" } as any] })).toThrow();
  });

  test("resolveFtsColumns(true) throws when no TEXT columns", () => {
    const numMeta = introspectTable("nums", Object({ id: Integer(), n: Integer() }), undefined, "id");
    expect(() => resolveFtsColumns(numMeta, true)).toThrow();
  });

  test("buildCreateFtsSQL uses external content + prefix name", () => {
    const sql = buildCreateFtsSQL("docs", ["title", "body"], {});
    expect(sql).toContain(`CREATE VIRTUAL TABLE IF NOT EXISTS "_foxdb_fts_docs"`);
    expect(sql).toContain(`content='docs'`);
    expect(sql).toContain(`content_rowid='rowid'`);
    expect(sql).toContain(`"title"`);
    expect(sql).toContain(`"body"`);
  });

  test("buildCreateFtsSQL includes tokenizer + prefix when provided", () => {
    const sql = buildCreateFtsSQL("docs", ["title"], { tokenizer: "porter unicode61", prefix: [2, 3] });
    expect(sql).toContain(`tokenize='porter unicode61'`);
    expect(sql).toContain(`prefix='2 3'`);
  });

  test("buildFtsIndexInsert selects rowid+cols from base by pk", () => {
    const { sql, placeholders } = buildFtsIndexInsert("docs", "id", ["title", "body"], 2, "pk");
    expect(sql).toContain(`INSERT INTO "_foxdb_fts_docs"("rowid", "title", "body")`);
    expect(sql).toContain(`SELECT "rowid", "title", "body" FROM "docs" WHERE "id" IN (?, ?)`);
    expect(placeholders).toBe(2);
  });

  test("buildFtsIndexInsert by rowid", () => {
    const { sql } = buildFtsIndexInsert("docs", "id", ["title"], 1, "rowid");
    expect(sql).toContain(`FROM "docs" WHERE "rowid" IN (?)`);
  });

  test("buildFtsDeleteCommand emits the 'delete' command form", () => {
    const { sql } = buildFtsDeleteCommand("docs", "id", ["title", "body"], 1, "pk");
    expect(sql).toContain(`INSERT INTO "_foxdb_fts_docs"("_foxdb_fts_docs", "rowid", "title", "body")`);
    expect(sql).toContain(`SELECT 'delete', "rowid", "title", "body" FROM "docs" WHERE "id" IN (?)`);
  });

  test("delete-all and rebuild", () => {
    expect(buildFtsDeleteAllSQL("docs")).toContain(`VALUES('delete-all')`);
    expect(buildFtsRebuildSQL("docs")).toContain(`VALUES('rebuild')`);
  });
});
