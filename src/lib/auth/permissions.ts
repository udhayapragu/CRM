import type { Role } from "@prisma/client";

export const PERMISSIONS = [
  "dashboard:view",
  "products:view",
  "products:edit",
  "inventory:view",
  "inventory:adjust",
  "inventory:manage",
  "orders:view",
  "orders:edit",
  "orders:view_pii",
  "dispatch:view",
  "dispatch:manage",
  "onboarding:view",
  "onboarding:manage",
  "reports:view",
  "reports:export",
  "reports:export_sensitive",
  "integration:view",
  "integration:manage",
  "users:manage",
  "audit:view",
  "settings:manage",
  "notifications:view",
  "mlm:view",
  "mlm:manage",
  "mlm:approve",
  "mlm:pay",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEW_BASE: Permission[] = [
  "dashboard:view",
  "products:view",
  "inventory:view",
  "orders:view",
  "dispatch:view",
  "onboarding:view",
  "reports:view",
  "notifications:view",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  INVENTORY_MANAGER: [
    ...VIEW_BASE,
    "products:edit",
    "inventory:adjust",
    "inventory:manage",
    "reports:export",
  ],
  ORDER_MANAGER: [...VIEW_BASE, "orders:edit", "orders:view_pii", "reports:export", "reports:export_sensitive"],
  DISPATCH_MANAGER: [...VIEW_BASE, "orders:view_pii", "dispatch:manage", "reports:export"],
  ONBOARDING_MANAGER: [...VIEW_BASE, "onboarding:manage", "reports:export"],
  ACCOUNTANT: [
    ...VIEW_BASE,
    "reports:export",
    "reports:export_sensitive",
    "orders:view_pii",
    "audit:view",
    "integration:view",
    "mlm:view",
    "mlm:approve",
    "mlm:pay",
  ],
  VIEWER: [...VIEW_BASE, "mlm:view"],
};

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  INVENTORY_MANAGER: "Inventory Manager",
  ORDER_MANAGER: "Order Manager",
  DISPATCH_MANAGER: "Dispatch Manager",
  ONBOARDING_MANAGER: "Product Onboarding Manager",
  ACCOUNTANT: "Accountant",
  VIEWER: "Read-Only Viewer",
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** Roles that should receive notifications of a given kind. */
export function rolesWith(permission: Permission): Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => ROLE_PERMISSIONS[r].includes(permission));
}
