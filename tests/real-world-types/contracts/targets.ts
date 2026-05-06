import { Type } from "typebox";
import { StrictObject } from "../common";

const TargetViewSchema = StrictObject({
  group: Type.String(),
  count: Type.Number(),
  max: Type.Optional(Type.Number()),
});

export const TargetsResponseSchema = StrictObject({
  DAY: Type.Array(TargetViewSchema),
  WEEK: Type.Array(TargetViewSchema),
  MONTH: Type.Array(TargetViewSchema),
  YEAR: Type.Array(TargetViewSchema),
});
