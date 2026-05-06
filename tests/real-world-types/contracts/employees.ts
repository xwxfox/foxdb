import { Type } from "typebox";
import { DateValueSchema, StrictObject } from "../common";

const EmployeeStatusSchema = Type.Union([
  Type.Literal("ACTIVE"),
  Type.Literal("INACTIVE"),
  Type.Literal("SABBATICAL"),
]);

const EmployeeTypeSchema = Type.Union([
  Type.Literal("NORMAL"),
  Type.Literal("EXTERNAL"),
  Type.Literal("SERVICE_ACCOUNT"),
]);

const TeamKindSchema = Type.Union([
  Type.Literal("PERSONAL"),
  Type.Literal("PRODUCT_GROUP"),
  Type.Literal("INTERNAL_MANAGED"),
]);

const EmployeeFilterTableTypeSchema = Type.Union([
  Type.Literal("DELIVERIES"),
  Type.Literal("PURCHASES"),
]);

const ProductGroupRoleSchema = Type.Union([
  Type.Literal("MANAGER"),
  Type.Literal("MEMBER"),
  Type.Literal("VIEWER"),
]);

const OrganizationSchema = StrictObject({
  id: Type.String(),
  name: Type.String(),
  slug: Type.String(),
  logo: Type.Union([Type.String(), Type.Null()]),
  createdAt: DateValueSchema,
  metadata: Type.Union([Type.String(), Type.Null()]),
});

const TeamSchema = StrictObject({
  id: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  accentColor: Type.Union([Type.String(), Type.Null()]),
  icon: Type.Union([Type.String(), Type.Null()]),
  organizationId: Type.String(),
  createdAt: DateValueSchema,
  updatedAt: Type.Union([DateValueSchema, Type.Null()]),
  kind: TeamKindSchema,
  metadata: Type.Union([Type.Unknown(), Type.Null()]),
});

const TeamMemberWithTeamSchema = StrictObject({
  id: Type.String(),
  teamId: Type.String(),
  userId: Type.String(),
  createdAt: Type.Union([DateValueSchema, Type.Null()]),
  role: Type.Union([Type.String(), Type.Null()]),
  team: TeamSchema,
});

const ProductGroupGoalsSchema = StrictObject({
  productGroupId: Type.String(),
  turnover: Type.Number(),
  margin: Type.Number(),
  inventory: Type.Number(),
  createdAt: DateValueSchema,
  updatedAt: DateValueSchema,
});

const ProductGroupMembershipSchema = StrictObject({
  id: Type.String(),
  userId: Type.String(),
  productGroupId: Type.String(),
  role: ProductGroupRoleSchema,
  canViewPeer: Type.Boolean(),
  createdAt: DateValueSchema,
  updatedAt: DateValueSchema,
});

const ProductGroupWithRelationsSchema = StrictObject({
  id: Type.String(),
  organizationId: Type.String(),
  name: Type.String(),
  slug: Type.String(),
  friendlyName: Type.Union([Type.String(), Type.Null()]),
  description: Type.Union([Type.String(), Type.Null()]),
  manufacturerCodes: Type.Array(Type.String()),
  metadata: Type.Union([Type.Unknown(), Type.Null()]),
  teamId: Type.Union([Type.String(), Type.Null()]),
  createdAt: DateValueSchema,
  updatedAt: DateValueSchema,
  organization: OrganizationSchema,
  team: Type.Union([TeamSchema, Type.Null()]),
  memberships: Type.Array(ProductGroupMembershipSchema),
  goals: Type.Union([ProductGroupGoalsSchema, Type.Null()]),
});

const EmployeeProductGroupMembershipWithGroupSchema = StrictObject({
  id: Type.String(),
  userId: Type.String(),
  productGroupId: Type.String(),
  role: ProductGroupRoleSchema,
  canViewPeer: Type.Boolean(),
  createdAt: DateValueSchema,
  updatedAt: DateValueSchema,
  productGroup: ProductGroupWithRelationsSchema,
});

const EmployeeGoalsSchema = StrictObject({
  userId: Type.String(),
  turnover: Type.Number(),
  margin: Type.Number(),
  inventory: Type.Number(),
  createdAt: DateValueSchema,
  updatedAt: DateValueSchema,
});

const EmployeeSettingsSchema = StrictObject({
  userId: Type.String(),
  dashboardOverviewViewMode: Type.String(),
  dashboardOverviewShowGauges: Type.Boolean(),
  dashboardLeadershipViewMode: Type.String(),
  dashboardSalesShowGauges: Type.Boolean(),
  dashboardSalesPersonalShowGauges: Type.Boolean(),
  recentsPreferredTab: Type.String(),
  recentsShowSidebar: Type.Boolean(),
  recentsSidebarSize: Type.Number(),
  recentsShowCountryFlags: Type.Boolean(),
  kameleonSettings: Type.String(),
  hasCompletedTour: Type.Boolean(),
  createdAt: DateValueSchema,
  updatedAt: DateValueSchema,
});

const EmployeeFilterSchema = StrictObject({
  id: Type.String(),
  userId: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  tableType: EmployeeFilterTableTypeSchema,
  state: Type.Union([Type.Unknown(), Type.Null()]),
  isPrimary: Type.Boolean(),
  autoSizeColumns: Type.Boolean(),
  applyOnAllTab: Type.Boolean(),
  setDateToToday: Type.Boolean(),
  createdAt: DateValueSchema,
  updatedAt: DateValueSchema,
});

export const EmployeeRecordSchema = StrictObject({
  id: Type.String(),
  name: Type.String(),
  email: Type.String(),
  emailVerified: Type.Boolean(),
  image: Type.Union([Type.String(), Type.Null()]),
  givenName: Type.Union([Type.String(), Type.Null()]),
  familyName: Type.Union([Type.String(), Type.Null()]),
  orgName: Type.Union([Type.String(), Type.Null()]),
  telephone: Type.Union([Type.String(), Type.Null()]),
  ldapDn: Type.Union([Type.String(), Type.Null()]),
  createdAt: DateValueSchema,
  updatedAt: DateValueSchema,
  role: Type.Union([Type.String(), Type.Null()]),
  banned: Type.Union([Type.Boolean(), Type.Null()]),
  banReason: Type.Union([Type.String(), Type.Null()]),
  banExpires: Type.Union([DateValueSchema, Type.Null()]),
  organizationId: Type.String(),
  defaultTeamId: Type.Union([Type.String(), Type.Null()]),
  initials: Type.String(),
  displayName: Type.String(),
  status: EmployeeStatusSchema,
  type: EmployeeTypeSchema,
  jobTitle: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Union([Type.Unknown(), Type.Null()]),
  organization: OrganizationSchema,
  defaultTeam: Type.Union([TeamSchema, Type.Null()]),
  teammembers: Type.Array(TeamMemberWithTeamSchema),
  productGroups: Type.Array(EmployeeProductGroupMembershipWithGroupSchema),
  goals: Type.Union([EmployeeGoalsSchema, Type.Null()]),
  settings: Type.Union([EmployeeSettingsSchema, Type.Null()]),
  filters: Type.Array(EmployeeFilterSchema),
});

export const EmployeeListResponseSchema = Type.Array(EmployeeRecordSchema);

const PublicInfoTeamSchema = StrictObject({
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  accentColor: Type.Union([Type.String(), Type.Null()]),
  icon: Type.Union([Type.String(), Type.Null()]),
});

const PublicInfoTeamMemberSchema = StrictObject({
  teamId: Type.String(),
  role: Type.Union([Type.String(), Type.Null()]),
  team: PublicInfoTeamSchema,
});

const PublicInfoProductGroupSchema = StrictObject({
  name: Type.String(),
  slug: Type.String(),
  friendlyName: Type.Union([Type.String(), Type.Null()]),
  description: Type.Union([Type.String(), Type.Null()]),
  manufacturerCodes: Type.Array(Type.String()),
});

const PublicInfoProductGroupMembershipSchema = StrictObject({
  productGroupId: Type.String(),
  role: Type.Union([Type.String(), Type.Null()]),
  productGroup: PublicInfoProductGroupSchema,
});

export const EmployeePublicInfoSchema = StrictObject({
  id: Type.String(),
  name: Type.String(),
  email: Type.String(),
  image: Type.Union([Type.String(), Type.Null()]),
  initials: Type.String(),
  givenName: Type.Union([Type.String(), Type.Null()]),
  familyName: Type.Union([Type.String(), Type.Null()]),
  orgName: Type.Union([Type.String(), Type.Null()]),
  organizationId: Type.String(),
  telephone: Type.Union([Type.String(), Type.Null()]),
  jobTitle: Type.Union([Type.String(), Type.Null()]),
  teammembers: Type.Array(PublicInfoTeamMemberSchema),
  productGroups: Type.Array(PublicInfoProductGroupMembershipSchema),
});

const EmployeeSearchFilterResultSchema = StrictObject({
  employee: EmployeePublicInfoSchema,
  matchedFields: Type.Array(Type.String()),
  confidenceScore: Type.Number(),
});

export const EmployeeSearchSuccessResponseSchema = StrictObject({
  results: Type.Array(EmployeeSearchFilterResultSchema),
  totalResults: Type.Number(),
  page: Type.Number(),
  pageSize: Type.Number(),
  resultsInPage: Type.Number(),
  next: Type.Optional(Type.String()),
});
