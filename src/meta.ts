/**
 * foxdb/src/meta.ts
 * TypeBox-backed metadata store for foxdb.
 *
 * Every DB row is validated at runtime with Schema.Compile.
 */

import { Type, type Static, type TSchema } from "typebox";
import { Compile, type Validator } from "typebox/schema";
import { BunDatabase } from "./database.ts";

// --- Row schema ---------------------------------------------------------------

const MetaRecordSchema = Type.Object({
  key: Type.String(),
  value: Type.String(),
  encoding: Type.String(),
  updatedAt: Type.Integer(),
});

const MetaCompiled = Compile(MetaRecordSchema);

type MetaRecord = Static<typeof MetaRecordSchema>;

// --- Typed-accessor schemas ---------------------------------------------------

const SchemaHashSchema = Type.String();

export const SchemaJSONSchema = Type.Record(Type.String(), Type.Unknown());

const TablesSchema = Type.Array(Type.String());

const RelationsSchema = Type.Array(
  Type.Object({
    ownerTable: Type.String(),
    ownerField: Type.String(),
    targetTable: Type.String(),
    targetField: Type.String(),
    kind: Type.Union([Type.Literal("scalar"), Type.Literal("subTable")]),
    as: Type.Optional(Type.String()),
  })
);

const VersionSchema = Type.String();

const SchemaHashCompiled = Compile(SchemaHashSchema);
const SchemaJSONCompiled = Compile(SchemaJSONSchema);
const TablesCompiled = Compile(TablesSchema);
const RelationsCompiled = Compile(RelationsSchema);
const VersionCompiled = Compile(VersionSchema);

type SchemaHash = Static<typeof SchemaHashSchema>;
export type SchemaJSON = Static<typeof SchemaJSONSchema>;
type TablesList = Static<typeof TablesSchema>;
type RelationsList = Static<typeof RelationsSchema>;
type Version = Static<typeof VersionSchema>;

// --- Encoding constants -------------------------------------------------------

const ENCODING_PLAIN = "plain";
const ENCODING_JSON = "json";
const ENCODING_DEFLATE_BASE64 = "deflate-base64";

// --- MetaStore ---------------------------------------------------------------

/** @category Database */
export class MetaStore {
  private readonly db: BunDatabase;

  private static readonly KEY_SCHEMA_HASH = "schemaHash";
  private static readonly KEY_SCHEMA_JSON = "schemaJSON";
  private static readonly KEY_TABLES = "tables";
  private static readonly KEY_RELATIONS = "relations";
  private static readonly KEY_VERSION = "version";

  constructor(db: BunDatabase) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _foxdb_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        encoding TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);
  }

  // --- Core helpers -----------------------------------------------------------

  private getRow(key: string): MetaRecord | null {
    const stmt = this.db.prepare(
      "SELECT key, value, encoding, updatedAt FROM _foxdb_meta WHERE key = ?"
    );
    const raw = stmt.get(key);
    if (raw == null) return null;

    try {
      return MetaCompiled.Parse(raw);
    } catch {
      const [, errors] = MetaCompiled.Errors(raw);
      throw new Error(
        `MetaStore: row validation failed for key "${key}". Errors: ${JSON.stringify(errors)}`
      );
    }
  }

  private setRow(key: string, value: string, encoding: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO _foxdb_meta (key, value, encoding, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET
        value = excluded.value,
        encoding = excluded.encoding,
        updatedAt = excluded.updatedAt
    `);
    stmt.run(key, value, encoding, Date.now());
  }

  private getValidatedJSON<S extends TSchema>(
    key: string,
    validator: Validator<S>,
    jsonString: string
  ): Static<S> | null {
    const parsed = JSON.parse(jsonString);
    if (!validator.Check(parsed)) {
      const [, errors] = validator.Errors(parsed);
      throw new Error(
        `MetaStore: JSON validation failed for key "${key}". Errors: ${JSON.stringify(errors)}`
      );
    }
    return parsed as Static<S>;
  }

  private validateAndSetJSON<S extends TSchema>(
    key: string,
    validator: Validator<S>,
    value: Static<S>
  ): void {
    if (!validator.Check(value)) {
      const [, errors] = validator.Errors(value);
      throw new Error(
        `MetaStore: JSON validation failed for key "${key}" before write. Errors: ${JSON.stringify(errors)}`
      );
    }
    this.setRow(key, JSON.stringify(value), ENCODING_JSON);
  }

  // --- String accessors -------------------------------------------------------

  getString(key: string): string | null {
    const row = this.getRow(key);
    if (row == null) return null;
    return row.value;
  }

  setString(key: string, value: string): void {
    this.setRow(key, value, ENCODING_PLAIN);
  }

  // --- JSON accessors ---------------------------------------------------------

  getJSON<T>(key: string): T | null {
    const row = this.getRow(key);
    if (row == null) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  setJSON(key: string, value: unknown): void {
    this.setRow(key, JSON.stringify(value), ENCODING_JSON);
  }

  // --- Compressed accessors ---------------------------------------------------

  getCompressed(key: string): Uint8Array | null {
    const row = this.getRow(key);
    if (row == null) return null;
    if (row.encoding !== ENCODING_DEFLATE_BASE64) return null;
    const decoded = Uint8Array.fromBase64(row.value);
    return Bun.inflateSync(decoded);
  }

  setCompressed(key: string, data: Uint8Array): void {
    const copy = new Uint8Array(data);
    const deflated = Bun.deflateSync(copy);
    const encoded = deflated.toBase64();
    this.setRow(key, encoded, ENCODING_DEFLATE_BASE64);
  }

  // --- Delete -----------------------------------------------------------------

  delete(key: string): void {
    const stmt = this.db.prepare("DELETE FROM _foxdb_meta WHERE key = ?");
    stmt.run(key);
  }

  // --- Typed accessors --------------------------------------------------------

  getSchemaHash(): SchemaHash | null {
    const row = this.getRow(MetaStore.KEY_SCHEMA_HASH);
    if (row == null) return null;
    return row.value as SchemaHash;
  }

  setSchemaHash(value: SchemaHash): void {
    this.setRow(MetaStore.KEY_SCHEMA_HASH, value as string, ENCODING_PLAIN);
  }

  getSchemaJSON(): SchemaJSON | null {
    const row = this.getRow(MetaStore.KEY_SCHEMA_JSON);
    if (row == null) return null;
    return this.getValidatedJSON(MetaStore.KEY_SCHEMA_JSON, SchemaJSONCompiled, row.value);
  }

  setSchemaJSON(value: SchemaJSON): void {
    this.validateAndSetJSON(MetaStore.KEY_SCHEMA_JSON, SchemaJSONCompiled, value);
  }

  getTables(): TablesList | null {
    const row = this.getRow(MetaStore.KEY_TABLES);
    if (row == null) return null;
    return this.getValidatedJSON(MetaStore.KEY_TABLES, TablesCompiled, row.value);
  }

  setTables(value: TablesList): void {
    this.validateAndSetJSON(MetaStore.KEY_TABLES, TablesCompiled, value);
  }

  getRelations(): RelationsList | null {
    const row = this.getRow(MetaStore.KEY_RELATIONS);
    if (row == null) return null;
    return this.getValidatedJSON(MetaStore.KEY_RELATIONS, RelationsCompiled, row.value);
  }

  setRelations(value: RelationsList): void {
    this.validateAndSetJSON(MetaStore.KEY_RELATIONS, RelationsCompiled, value);
  }

  getVersion(): Version | null {
    const row = this.getRow(MetaStore.KEY_VERSION);
    if (row == null) return null;
    return row.value as Version;
  }

  setVersion(value: Version): void {
    this.setRow(MetaStore.KEY_VERSION, value as string, ENCODING_PLAIN);
  }
}