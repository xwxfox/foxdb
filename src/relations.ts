/**
 * foxdb/src/relations.ts
 * Type-safe relation builder. Constrains ownerField and targetField
 * to actual columns in the respective table schemas.
 */

import type { TObject } from "typebox";
import type { TableConfig, ScalarKeys, AnyTableConfig } from "./types.ts";
import type { TypedRelation } from "./typed-relation.ts";
import type { TableDescriptor } from "./table.ts";
export class RelationBuilder<
  Tables extends Record<string, TableDescriptor<any, any, any, any, any>>
> {
  private readonly relations: TypedRelation[] = [];

  constructor(private readonly tables: Tables) { }

  from<Owner extends keyof Tables & string>(ownerTable: Owner) {
    const _ownerTable = ownerTable;
    return {
      scalar: <const Field extends ScalarKeys<Tables[Owner]["schema"]>>(
        field: Field
      ) => ({
        to: <
          Target extends keyof Tables & string,
          TField extends ScalarKeys<Tables[Target]["schema"]>,
          const As extends string | undefined = undefined
        >(
          targetTable: Target,
          targetField: TField,
          opts?: { as?: As }
        ): TypedRelation<Owner, Field, Target, TField, "scalar", As> => {
          const rel: TypedRelation = {
            ownerTable: _ownerTable,
            ownerField: field,
            targetTable,
            targetField,
            kind: "scalar",
            as: opts?.as,
          };
          this.relations.push(rel);
          return rel as TypedRelation<Owner, Field, Target, TField, "scalar", As>;
        },
      }),

      subTable: <const Sub extends string, const Col extends string>(
        subField: Sub,
        subColumn: Col
      ) => ({
        to: <
          Target extends keyof Tables & string,
          TField extends ScalarKeys<Tables[Target]["schema"]>,
          const As extends string | undefined = undefined
        >(
          targetTable: Target,
          targetField: TField,
          opts?: { as?: As }
        ): TypedRelation<Owner, `${Sub}.${Col}`, Target, TField, "subTable", As> => {
          const rel: TypedRelation = {
            ownerTable: _ownerTable,
            ownerField: `${subField}.${subColumn}`,
            targetTable,
            targetField,
            kind: "subTable",
            as: opts?.as,
          };
          this.relations.push(rel);
          return rel as TypedRelation<Owner, `${Sub}.${Col}`, Target, TField, "subTable", As>;
        },
      }),
    };
  }

  build(): TypedRelation[] {
    return this.relations;
  }
}

/** @category Relations */
export function createRelationBuilder<T extends Record<string, TableDescriptor<any, any, any, any, any>>>(
  tables: T
): RelationBuilder<T> {
  return new RelationBuilder(tables);
}
