// Money, dates, financial-year helpers, permissions — shared by server code.
import { Client, HttpError, SessionUser, q1 } from "./db";

export const toPaise = (n: number | string | null | undefined) => Math.round(Number(n || 0) * 100 + (Number(n || 0) < 0 ? -1e-9 : 1e-9));
export const fromPaise = (p: number) => p / 100;
export const r2 = (n: number) => fromPaise(toPaise(n));

export const today = () => new Date().toISOString().slice(0, 10);

/** Indian financial year label (Apr–Mar) for a YYYY-MM-DD date, e.g. 2026-27 */
export function fyOf(date: string): string {
  const y = +date.slice(0, 4), m = +date.slice(5, 7);
  const s = m >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
}
export function fyRange(label: string): { start: string; end: string } {
  const s = +label.slice(0, 4);
  return { start: `${s}-04-01`, end: `${s + 1}-03-31` };
}
export function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function addMonths(date: string, months: number) {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export type Preset = "today" | "week" | "month" | "last_month" | "quarter" | "fy" | "custom";
/** Resolve a dashboard date preset to a concrete [from,to] range. */
export function presetRange(preset: string, from?: string, to?: string): { from: string; to: string } {
  const t = today();
  const y = +t.slice(0, 4), m = +t.slice(5, 7);
  switch (preset) {
    case "today": return { from: t, to: t };
    case "week": {
      const d = new Date(t + "T00:00:00Z");
      const dow = (d.getUTCDay() + 6) % 7; // Monday start
      return { from: addDays(t, -dow), to: t };
    }
    case "month": return { from: `${t.slice(0, 7)}-01`, to: monthEnd(t.slice(0, 7)) };
    case "last_month": {
      const lm = addMonths(`${t.slice(0, 7)}-01`, -1);
      return { from: lm, to: monthEnd(lm.slice(0, 7)) };
    }
    case "quarter": {
      // Indian FY quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar
      const sm = m >= 4 ? 4 + Math.floor((m - 4) / 3) * 3 : 1;
      const start = `${y}-${String(sm).padStart(2, "0")}-01`;
      return { from: start, to: monthEnd(addMonths(start, 2).slice(0, 7)) };
    }
    case "custom": return { from: from || `${t.slice(0, 7)}-01`, to: to || t };
    case "fy":
    default: {
      const r = fyRange(fyOf(t));
      return { from: r.start, to: r.end };
    }
  }
}

// ---- Permissions ----
export type Perm =
  | "ledger.read" | "txn.write" | "txn.approve" | "invoice.write" | "master.write" | "bank.write"
  | "reconcile" | "payroll.read" | "payroll.write" | "budget.write" | "tax.write"
  | "users.manage" | "company.manage" | "audit.read" | "settings";

const P: Record<SessionUser["role"], Perm[]> = {
  SUPER_ADMIN: ["ledger.read", "txn.write", "txn.approve", "invoice.write", "master.write", "bank.write", "reconcile", "payroll.read", "payroll.write", "budget.write", "tax.write", "users.manage", "company.manage", "audit.read", "settings"],
  COMPANY_ADMIN: ["ledger.read", "txn.write", "invoice.write", "master.write", "bank.write", "reconcile", "payroll.read", "payroll.write", "budget.write", "tax.write", "audit.read"],
  ACCOUNTANT: ["ledger.read", "txn.write", "invoice.write", "master.write", "reconcile", "bank.write", "tax.write", "budget.write"],
  VIEWER: ["ledger.read"],
};
export const can = (u: SessionUser, p: Perm) => P[u.role].includes(p);
export function need(u: SessionUser, p: Perm) {
  if (!can(u, p)) throw new HttpError(403, "You do not have permission to do this");
}
export const permsOf = (role: SessionUser["role"]) => P[role];

export function assertCompany(u: SessionUser, companyId: number) {
  if (!u.companyIds.includes(companyId)) throw new HttpError(403, "No access to this company");
}

/** Resolve ?company=all|<id> into the list of company ids the caller may see. */
export function scopeIds(u: SessionUser, company?: string | null): number[] {
  if (!company || company === "all") return u.companyIds;
  const id = Number(company);
  if (!u.companyIds.includes(id)) throw new HttpError(403, "No access to this company");
  return [id];
}
/** Writes must target exactly one company. */
export function writeCompany(u: SessionUser, company: unknown): number {
  const id = Number(company);
  if (!id) throw new HttpError(400, "Select a company");
  assertCompany(u, id);
  return id;
}

export async function nextNo(c: Client, companyId: number, kind: string, fy: string): Promise<number> {
  const r = await q1<{ last_no: number }>(
    c,
    `INSERT INTO doc_sequences (company_id, kind, fy, last_no) VALUES ($1,$2,$3,1)
     ON CONFLICT (company_id, kind, fy) DO UPDATE SET last_no = doc_sequences.last_no + 1 RETURNING last_no`,
    [companyId, kind, fy]
  );
  return r!.last_no;
}

export const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
