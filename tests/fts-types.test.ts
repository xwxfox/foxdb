/**
 * foxdb/tests/fts-types.test.ts
 * Compile-time checks for FTS typing. Passes if `bunx tsc --noEmit` is clean.
 */
import { describe, test, expect } from "bun:test";
import { Object, String, Number, Integer } from "typebox";
import type { FTSFields, FTSEnabled } from "../src/types.ts";
import { table } from "../src/table.ts";
import { createORM } from "../src/orm.ts";

const S = Object({
  id: String(),
  title: String(),
  body: String(),
  views: Integer(),
  meta: Object({ note: String(), rank: Number() }),
});

// fts: true → all TEXT scalar columns (incl. flattened nested string)
type AllText = FTSFields<typeof S, true>;
const a1: AllText = "title";
const a2: AllText = "body";
const a3: AllText = "meta__note";
void [a1, a2, a3];
// @ts-expect-error views is Integer, not text
const a4: AllText = "views";
void a4;

// enabled flags
const e1: FTSEnabled<true> = true;
const e2: FTSEnabled<undefined> = false;
void [e1, e2];

// table() accepts fts config forms
const _t1 = table(S, (s) => ({ primaryKey: s.id, fts: true }));
const _t2 = table(S, (s) => ({ primaryKey: s.id, fts: { columns: [s.title, s.body] } }));
const _t3 = table(S, (s) => ({ primaryKey: s.id })); // no fts
void [_t1, _t2, _t3];

describe("fts types", () => {
  test("placeholder runtime assertion", () => {
    expect(true).toBe(true);
  });
});

function _ftsGating() {
  const withFts = createORM({ tables: { docs: table(S, (s) => ({ primaryKey: s.id, fts: { columns: [s.title] } })) } });
  withFts.docs.search("x").highlight("title").exec();
  // @ts-expect-error "views" is not an indexed fts field
  withFts.docs.search("x").highlight("views");
  // @ts-expect-error "body" is not in the configured columns ([title] only)
  withFts.docs.search("x").snippet("body");
  withFts._close();

  const withAll = createORM({ tables: { docs: table(S, (s) => ({ primaryKey: s.id, fts: true })) } });
  withAll.docs.search("x").highlight("meta__note").exec();
  // @ts-expect-error views is Integer, not text
  withAll.docs.search("x").highlight("views");
  withAll._close();

  const noFts = createORM({ tables: { docs: table(S, (s) => ({ primaryKey: s.id })) } });
  // @ts-expect-error search must NOT exist on non-fts tables
  noFts.docs.search;
  // @ts-expect-error searchAsync must NOT exist on non-fts tables
  noFts.docs.searchAsync;
  noFts._close();
}
void _ftsGating;
