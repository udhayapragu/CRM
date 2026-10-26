import type { Permission } from "@/lib/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission: Permission;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", permission: "dashboard:view" }] },
  {
    label: "Commerce",
    items: [
      { href: "/products", label: "Products", icon: "Gem", permission: "products:view" },
      { href: "/orders", label: "Orders", icon: "ShoppingBag", permission: "orders:view" },
      { href: "/dispatch", label: "Dispatch", icon: "Truck", permission: "dispatch:view" },
    ],
  },
  {
    label: "Warehouse",
    items: [
      { href: "/inventory", label: "Inventory", icon: "Boxes", permission: "inventory:view" },
      { href: "/inventory/movements", label: "Stock Ledger", icon: "ScrollText", permission: "inventory:view" },
      { href: "/inventory/receipts", label: "Goods Received", icon: "PackagePlus", permission: "inventory:view" },
      { href: "/inventory/rules", label: "Packaging Rules", icon: "Workflow", permission: "inventory:view" },
      { href: "/inventory/suppliers", label: "Suppliers", icon: "Building2", permission: "inventory:view" },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/onboarding", label: "Onboarding", icon: "Sparkles", permission: "onboarding:view" },
      { href: "/mlm", label: "Direct Selling", icon: "Network", permission: "mlm:view" },
      { href: "/reports", label: "Reports", icon: "FileSpreadsheet", permission: "reports:view" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/settings/integration", label: "WordPress Sync", icon: "PlugZap", permission: "integration:view" },
      { href: "/settings/users", label: "Users & Roles", icon: "Users", permission: "users:manage" },
      { href: "/settings/audit", label: "Audit Log", icon: "ShieldCheck", permission: "audit:view" },
      { href: "/settings/general", label: "Settings", icon: "Settings", permission: "settings:manage" },
    ],
  },
];
