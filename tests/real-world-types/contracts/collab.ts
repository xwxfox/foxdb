import { Type, type Static } from "typebox";
import { StrictObject } from "../common";

export const TeamHexColorSchema = Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" });

export const CreateTeamInputSchema = StrictObject({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  description: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  accentColor: Type.Optional(Type.Union([TeamHexColorSchema, Type.Null()])),
});

export const UpdateTeamInputSchema = StrictObject({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.Union([Type.String({ maxLength: 600 }), Type.Null()]),
  accentColor: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
});

export const InviteInputSchema = StrictObject({
  email: Type.String({ format: "email" }),
  role: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const UpdateProductGroupInputSchema = StrictObject({
  friendlyName: Type.Union([Type.String(), Type.Null()]),
  description: Type.Union([Type.String(), Type.Null()]),
  manufacturerCodes: Type.Array(Type.String()),
});

export const UpdateEmployeeInputSchema = StrictObject({
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  givenName: Type.Optional(Type.String({ maxLength: 160 })),
  familyName: Type.Optional(Type.String({ maxLength: 160 })),
  jobTitle: Type.Optional(Type.String({ maxLength: 160 })),
  telephone: Type.Optional(Type.String({ maxLength: 60 })),
  status: Type.Optional(Type.Union([Type.Literal("ACTIVE"), Type.Literal("INACTIVE"), Type.Literal("SABBATICAL")])),
  type: Type.Optional(Type.Union([Type.Literal("NORMAL"), Type.Literal("EXTERNAL"), Type.Literal("SERVICE_ACCOUNT")])),
  orgName: Type.Optional(Type.String({ maxLength: 160 })),
});

export const UpdateGoalsInputSchema = StrictObject({
  turnover: Type.Optional(Type.Integer()),
  margin: Type.Optional(Type.Integer()),
  inventory: Type.Optional(Type.Integer()),
});

export const UpdateRolesInputSchema = StrictObject({
  roles: Type.Array(Type.String({ minLength: 1 })),
});

export const AddToTeamInputSchema = StrictObject({
  teamId: Type.String({ minLength: 1 }),
  role: Type.Optional(Type.String()),
});

export const AssignProductGroupInputSchema = StrictObject({
  productGroupId: Type.String({ minLength: 1 }),
  role: Type.Optional(Type.Union([Type.Literal("MANAGER"), Type.Literal("MEMBER"), Type.Literal("VIEWER")])),
  canViewPeer: Type.Optional(Type.Boolean()),
});

export const UpdateOrganizationInputSchema = StrictObject({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  slug: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  logo: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
});

export const CreateAdminTeamInputSchema = StrictObject({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.Optional(Type.String({ maxLength: 600 })),
  accentColor: Type.Optional(Type.String({ maxLength: 40 })),
  icon: Type.Optional(Type.String({ maxLength: 160 })),
  kind: Type.Optional(Type.Union([Type.Literal("PERSONAL"), Type.Literal("PRODUCT_GROUP"), Type.Literal("INTERNAL_MANAGED")])),
});

export const UpdateAdminTeamInputSchema = StrictObject({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  description: Type.Optional(Type.String({ maxLength: 600 })),
  accentColor: Type.Optional(Type.String({ maxLength: 40 })),
  icon: Type.Optional(Type.String({ maxLength: 160 })),
  kind: Type.Optional(Type.Union([Type.Literal("PERSONAL"), Type.Literal("PRODUCT_GROUP"), Type.Literal("INTERNAL_MANAGED")])),
});

export const AddTeamMemberInputSchema = StrictObject({
  userId: Type.String({ minLength: 1 }),
  role: Type.Optional(Type.String()),
});

export const CreateProductGroupInputSchema = StrictObject({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  slug: Type.String({ minLength: 1, maxLength: 160 }),
  friendlyName: Type.Optional(Type.Union([Type.String({ maxLength: 160 }), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String({ maxLength: 600 }), Type.Null()])),
  manufacturerCodes: Type.Optional(Type.Array(Type.String({ maxLength: 40 }))),
  teamId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
});

export const UpdateAdminProductGroupInputSchema = StrictObject({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  slug: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  friendlyName: Type.Optional(Type.Union([Type.String({ maxLength: 160 }), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String({ maxLength: 600 }), Type.Null()])),
  manufacturerCodes: Type.Optional(Type.Array(Type.String({ maxLength: 40 }))),
  teamId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
});

export const AddProductGroupMemberInputSchema = StrictObject({
  userId: Type.String({ minLength: 1 }),
  role: Type.Optional(Type.Union([Type.Literal("MANAGER"), Type.Literal("MEMBER"), Type.Literal("VIEWER")])),
  canViewPeer: Type.Optional(Type.Boolean()),
});

export type CreateTeamInput = Static<typeof CreateTeamInputSchema>;
export type UpdateTeamInput = Static<typeof UpdateTeamInputSchema>;
export type InviteInput = Static<typeof InviteInputSchema>;
export type UpdateProductGroupInput = Static<typeof UpdateProductGroupInputSchema>;
export type UpdateEmployeeInput = Static<typeof UpdateEmployeeInputSchema>;
export type UpdateGoalsInput = Static<typeof UpdateGoalsInputSchema>;
export type UpdateRolesInput = Static<typeof UpdateRolesInputSchema>;
export type AddToTeamInput = Static<typeof AddToTeamInputSchema>;
export type AssignProductGroupInput = Static<typeof AssignProductGroupInputSchema>;
export type UpdateOrganizationInput = Static<typeof UpdateOrganizationInputSchema>;
export type CreateAdminTeamInput = Static<typeof CreateAdminTeamInputSchema>;
export type UpdateAdminTeamInput = Static<typeof UpdateAdminTeamInputSchema>;
export type AddTeamMemberInput = Static<typeof AddTeamMemberInputSchema>;
export type CreateProductGroupInput = Static<typeof CreateProductGroupInputSchema>;
export type UpdateAdminProductGroupInput = Static<typeof UpdateAdminProductGroupInputSchema>;
export type AddProductGroupMemberInput = Static<typeof AddProductGroupMemberInputSchema>;
