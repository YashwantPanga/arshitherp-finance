export interface NavItem { title: string; link?: string; icon?: string; group?: string; perm?: string }

// Sidebar structure of the finance ERP. `perm` hides items the signed-in role cannot use.
export const NAV: NavItem[] = [
  { title: "Overview", group: "Overview" },
  { title: "Dashboard", link: "/", icon: "ti-layout-dashboard" },
  { title: "Money", group: "Money" },
  { title: "Income", link: "/income", icon: "ti-arrow-down-left" },
  { title: "Expenses", link: "/expenses", icon: "ti-arrow-up-right" },
  { title: "Receivables & Invoices", link: "/receivables", icon: "ti-file-invoice" },
  { title: "Payables & Bills", link: "/payables", icon: "ti-receipt-2" },
  { title: "Cash & Bank", link: "/banking", icon: "ti-building-bank" },
  { title: "Accounting", group: "Accounting" },
  { title: "Reports", link: "/reports", icon: "ti-report-analytics" },
  { title: "Budgets", link: "/budgets", icon: "ti-target-arrow" },
  { title: "GST & Tax", link: "/tax", icon: "ti-percentage" },
  { title: "Payroll", link: "/payroll", icon: "ti-users-group", perm: "payroll.read" },
  { title: "Customers & Vendors", link: "/parties", icon: "ti-address-book" },
  { title: "Administration", group: "Administration", perm: "audit.read" },
  { title: "Audit Log", link: "/audit", icon: "ti-history", perm: "audit.read" },
  { title: "Users & Access", link: "/users", icon: "ti-user-shield", perm: "users.manage" },
  { title: "Settings", link: "/settings", icon: "ti-settings", perm: "settings" },
];
