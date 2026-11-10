// Read-only financial reporting. Everything is derived from posted journal lines (the ledger),
// so dashboards, statements and exports can never drift apart.
import { Client, SessionUser, q, q1, HttpError } from "./db";
import { addDays, addMonths, can, fyOf, fyRange, monthEnd, presetRange, r2, scopeIds, today } from "./core";
import { STATUS_SQL } from "./docs";

export interface Params {
  company?: string; from?: string; to?: string; preset?: string; asOf?: string;
  category?: string; group?: string; status?: string; fy?: string;
}
export interface Col { key: string; label: string; kind?: "money" | "text" | "date" | "pct" | "int" }
export interface Report { title: string; subtitle: string; columns: Col[]; rows: any[]; meta?: Record<string, any> }

const money = (n: number) => r2(n || 0);

function range(p: Params) {
  if (p.preset && p.preset !== "custom") return presetRange(p.preset);
  const r = presetRange("custom", p.from, p.to);
  if (r.from > r.to) throw new HttpError(400, "From date is after To date");
  return r;
}

async function companyNames(c: Client, ids: number[]) {
  return q<{ id: number; name: string; code: string }>(c, "SELECT id,name,code FROM companies WHERE id=ANY($1) ORDER BY id", [ids]);
}
const scopeLabel = async (c: Client, ids: number[], all: number) => {
  if (ids.length === all && ids.length > 1) return "All companies";
  const n = await companyNames(c, ids);
  return n.map((x) => x.name).join(", ");
};

// ---------- ledger aggregation ----------
interface BalRow { company_id: number; month?: string; id: number; code: string; name: string; type: string; subtype: string; debit: number; credit: number }
export async function balances(c: Client, ids: number[], from?: string | null, to?: string | null, byMonth = false): Promise<BalRow[]> {
  return q(c,
    `SELECT a.company_id, ${byMonth ? "to_char(e.entry_date,'YYYY-MM') AS month," : ""} a.id, a.code, a.name, a.type, a.subtype,
            SUM(l.debit) AS debit, SUM(l.credit) AS credit
     FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
     WHERE a.company_id=ANY($1) AND ($2::date IS NULL OR e.entry_date>=$2) AND ($3::date IS NULL OR e.entry_date<=$3)
     GROUP BY a.company_id, ${byMonth ? "to_char(e.entry_date,'YYYY-MM')," : ""} a.id, a.code, a.name, a.type, a.subtype`,
    [ids, from ?? null, to ?? null]);
}
const dr = (r: BalRow) => r.debit - r.credit;
const cr = (r: BalRow) => r.credit - r.debit;
const sum = (rows: BalRow[], f: (r: BalRow) => boolean, v: (r: BalRow) => number) => rows.filter(f).reduce((s, r) => s + v(r), 0);

export function pl(rows: BalRow[]) {
  const revenue = sum(rows, (r) => r.subtype === "revenue", cr);
  const discounts = sum(rows, (r) => r.subtype === "discount", dr);
  const returns = sum(rows, (r) => r.subtype === "sales_return", dr);
  const other = sum(rows, (r) => r.subtype === "other_income", cr);
  const direct = sum(rows, (r) => r.type === "expense" && r.subtype === "direct_cost", dr);
  const opex = sum(rows, (r) => r.type === "expense" && r.subtype === "operating_expense", dr);
  const netRevenue = revenue - discounts - returns;
  const gross = netRevenue - direct;
  const operating = gross - opex;
  const income = netRevenue + other, expenses = direct + opex;
  return { revenue: money(revenue), discounts: money(discounts), returns: money(returns), other: money(other), direct: money(direct), opex: money(opex), netRevenue: money(netRevenue), gross: money(gross), operating: money(operating), income: money(income), expenses: money(expenses), net: money(income - expenses) };
}
const netResult = (rows: BalRow[]) => sum(rows, (r) => r.type === "income", cr) - sum(rows, (r) => r.type === "expense", dr);

// ---------- statement builder ----------
class Stmt {
  rows: any[] = [];
  constructor(public cols: { key: string; label: string }[], public totalCol = true) {}
  get columns(): Col[] {
    return [{ key: "label", label: "Particulars", kind: "text" }, ...this.cols.map((c) => ({ key: c.key, label: c.label, kind: "money" as const })), ...(this.totalCol ? [{ key: "total", label: "Total", kind: "money" as const }] : [])];
  }
  add(label: string, fn: (col: string) => number, style: "" | "head" | "sub" | "total" | "grand" = "", level = 0) {
    const row: any = { label, _style: style, _level: level };
    let t = 0;
    for (const c of this.cols) { row[c.key] = money(fn(c.key)); t += row[c.key]; }
    if (this.totalCol) row.total = money(t);
    this.rows.push(row);
  }
  head(label: string) { this.rows.push({ label, _style: "head", _level: 0 }); }
}

// ---------- Profit & Loss ----------
export async function profitLoss(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company);
  const { from, to } = range(p);
  const names = await companyNames(c, ids);
  const group = p.group || "company";
  let cols: { key: string; label: string }[];
  let data: Record<string, BalRow[]> = {};
  if (group === "company") {
    cols = names.map((n) => ({ key: "c" + n.id, label: n.name }));
    const rows = await balances(c, ids, from, to);
    for (const n of names) data["c" + n.id] = rows.filter((r) => r.company_id === n.id);
  } else {
    const rows = await balances(c, ids, from, to, true);
    const keyOf = (m: string) => {
      if (group === "month") return m;
      const fy = fyOf(m + "-01");
      if (group === "year") return "FY " + fy;
      const mm = +m.slice(5, 7); const qn = mm >= 4 ? Math.floor((mm - 4) / 3) + 1 : 4;
      return `${fy} Q${qn}`;
    };
    for (const r of rows) (data[keyOf(r.month!)] ??= []).push(r);
    cols = Object.keys(data).sort().map((k) => ({ key: k, label: k }));
    if (!cols.length) cols = [{ key: "none", label: "—" }];
  }
  const S = new Stmt(cols);
  const P = (k: string) => pl(data[k] || []);
  const detail = (pred: (r: BalRow) => boolean, v: (r: BalRow) => number) => {
    const m = new Map<string, string>();
    for (const col of cols) for (const r of data[col.key] || []) if (pred(r)) m.set(r.code, r.name);
    return [...m.entries()].sort().map(([code, name]) => ({ name, fn: (k: string) => (data[k] || []).filter((r) => r.code === code && pred(r)).reduce((s, r) => s + v(r), 0) }));
  };
  S.head("Revenue");
  detail((r) => r.subtype === "revenue", cr).forEach((d) => S.add(d.name, d.fn, "", 1));
  S.add("Gross Revenue", (k) => P(k).revenue, "sub");
  S.add("Less: Discounts", (k) => -P(k).discounts, "", 1);
  S.add("Less: Sales Returns & Refunds", (k) => -P(k).returns, "", 1);
  S.add("Net Revenue", (k) => P(k).netRevenue, "total");
  S.head("Direct Costs");
  detail((r) => r.type === "expense" && r.subtype === "direct_cost", dr).forEach((d) => S.add(d.name, d.fn, "", 1));
  S.add("Total Direct Costs", (k) => P(k).direct, "sub");
  S.add("Gross Profit", (k) => P(k).gross, "total");
  S.head("Operating Expenses");
  detail((r) => r.type === "expense" && r.subtype === "operating_expense", dr).forEach((d) => S.add(d.name, d.fn, "", 1));
  S.add("Total Operating Expenses", (k) => P(k).opex, "sub");
  S.add("Operating Profit", (k) => P(k).operating, "total");
  S.add("Other Income", (k) => P(k).other, "");
  S.add("Net Profit / (Loss)", (k) => P(k).net, "grand");
  const sub = `${from} to ${to} · ${await scopeLabel(c, ids, u.companyIds.length)}`;
  return { title: "Profit & Loss Statement", subtitle: sub, columns: S.columns, rows: S.rows, meta: { from, to, group } };
}

// ---------- Balance sheet ----------
export async function balanceSheet(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company);
  const asOf = p.asOf || p.to || today();
  const names = await companyNames(c, ids);
  const cols = names.map((n) => ({ key: "c" + n.id, label: n.name }));
  const all = await balances(c, ids, null, asOf);
  const fyStart = fyRange(fyOf(asOf)).start;
  const cur = await balances(c, ids, fyStart, asOf);
  const by = (k: string) => all.filter((r) => "c" + r.company_id === k);
  const curBy = (k: string) => cur.filter((r) => "c" + r.company_id === k);
  const S = new Stmt(cols);
  const A = (pred: (r: BalRow) => boolean, side: "d" | "c" = "d") => (k: string) => sum(by(k), pred, side === "d" ? dr : cr);
  const detail = (pred: (r: BalRow) => boolean, side: "d" | "c", label: string, level = 1) => {
    const m = new Map<string, string>();
    for (const r of all) if (pred(r)) m.set(r.code, r.name);
    [...m.entries()].sort().forEach(([code, name]) => S.add(name, (k) => sum(by(k), (r) => r.code === code, side === "d" ? dr : cr), "", level));
    void label;
  };
  const cash = (r: BalRow) => r.subtype === "cash", bank = (r: BalRow) => r.subtype === "bank";
  const otherA = (r: BalRow) => ["input_cgst", "input_sgst", "input_igst", "employee_advance", "other_asset"].includes(r.subtype);
  S.head("Assets");
  S.head("Cash in hand"); detail(cash, "d", "cash");
  S.head("Bank balances"); detail(bank, "d", "bank");
  S.add("Accounts Receivable", A((r) => r.subtype === "receivable"), "", 1);
  S.add("Inventory", A((r) => r.subtype === "inventory"), "", 1);
  S.add("Equipment & Fixed Assets", A((r) => r.subtype === "fixed_asset"), "", 1);
  S.add("Input GST & other assets", A(otherA), "", 1);
  const totalA = (k: string) => sum(by(k), (r) => r.type === "asset", dr);
  S.add("Total Assets", totalA, "total");
  S.head("Liabilities");
  S.add("Accounts Payable", A((r) => r.subtype === "payable", "c"), "", 1);
  S.add("Loans", A((r) => r.subtype === "loan", "c"), "", 1);
  S.add("Outstanding Expenses", A((r) => r.subtype === "outstanding_expense", "c"), "", 1);
  S.add("Tax Liabilities (GST / TDS)", A((r) => ["output_cgst", "output_sgst", "output_igst", "tds_payable"].includes(r.subtype), "c"), "", 1);
  S.add("Salary Payable & Other Liabilities", A((r) => ["salary_payable", "other_liability"].includes(r.subtype), "c"), "", 1);
  const totalL = (k: string) => sum(by(k), (r) => r.type === "liability", cr);
  S.add("Total Liabilities", totalL, "total");
  S.head("Equity");
  S.add("Capital (incl. opening balance equity)", A((r) => r.subtype === "capital" || r.subtype === "opening_equity", "c"), "", 1);
  const retained = (k: string) => sum(by(k), (r) => r.subtype === "retained", cr) + (netResult(by(k)) - netResult(curBy(k)));
  S.add("Retained Earnings (brought forward)", retained, "", 1);
  const curYear = (k: string) => netResult(curBy(k));
  S.add("Current Year Profit / (Loss)", curYear, "", 1);
  const totalE = (k: string) => sum(by(k), (r) => r.type === "equity", cr) + (netResult(by(k)) - netResult(curBy(k))) + curYear(k);
  S.add("Total Equity", totalE, "total");
  S.add("Total Liabilities + Equity", (k) => totalL(k) + totalE(k), "grand");
  const diff = cols.reduce((s, col) => s + Math.abs(totalA(col.key) - totalL(col.key) - totalE(col.key)), 0);
  return { title: "Balance Sheet", subtitle: `As of ${asOf} · ${await scopeLabel(c, ids, u.companyIds.length)}`, columns: S.columns, rows: S.rows, meta: { asOf, balanced: Math.abs(diff) < 0.005, difference: money(diff) } };
}

// ---------- Cash flow (direct method, derived from the ledger) ----------
interface CfLine { company_id: number; month: string; section: "operating" | "investing" | "financing"; label: string; amount: number }
const CF_LABEL: [string[], "operating" | "investing" | "financing", string][] = [
  [["receivable", "revenue", "other_income", "discount"], "operating", "Receipts from customers & other income"],
  [["sales_return"], "operating", "Refunds & sales returns"],
  [["payable", "direct_cost", "operating_expense", "inventory", "outstanding_expense"], "operating", "Payments to suppliers & operating expenses"],
  [["salary_payable", "employee_advance"], "operating", "Salaries & employee advances"],
  [["input_cgst", "input_sgst", "input_igst", "output_cgst", "output_sgst", "output_igst", "tds_payable"], "operating", "GST & TDS (net)"],
  [["fixed_asset"], "investing", "Purchase of equipment & fixed assets"],
  [["capital", "opening_equity"], "financing", "Capital introduced / drawings"],
  [["loan"], "financing", "Loans received / repaid"],
];
export async function cashFlowLines(c: Client, ids: number[], from: string, to: string): Promise<CfLine[]> {
  const rows = await q<any>(c,
    `SELECT e.company_id, to_char(e.entry_date,'YYYY-MM') AS month, a.subtype, (l.credit - l.debit) AS amt
     FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
     WHERE e.company_id=ANY($1) AND e.entry_date BETWEEN $2 AND $3 AND a.subtype NOT IN ('cash','bank')
       AND EXISTS (SELECT 1 FROM journal_entry_lines l2 JOIN accounts a2 ON a2.id=l2.account_id WHERE l2.entry_id=e.id AND a2.subtype IN ('cash','bank'))`,
    [ids, from, to]);
  return rows.map((r) => {
    const m = CF_LABEL.find(([s]) => s.includes(r.subtype));
    return { company_id: r.company_id, month: r.month, section: m?.[1] ?? "operating", label: m?.[2] ?? "Other operating", amount: r.amt };
  });
}
async function cashBalance(c: Client, ids: number[], upTo: string | null, before = false) {
  const r = await q1(c,
    `SELECT COALESCE(SUM(l.debit-l.credit),0) AS b FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
     WHERE a.company_id=ANY($1) AND a.subtype IN ('cash','bank') AND ($2::date IS NULL OR e.entry_date ${before ? "<" : "<="} $2)`, [ids, upTo]);
  return money(r!.b);
}
export async function cashFlow(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company);
  const { from, to } = range(p);
  const names = await companyNames(c, ids);
  const cols = names.map((n) => ({ key: "c" + n.id, label: n.name }));
  const lines = await cashFlowLines(c, ids, from, to);
  const S = new Stmt(cols);
  const opening: Record<string, number> = {};
  for (const n of names) opening["c" + n.id] = await cashBalance(c, [n.id], from, true);
  S.add("Opening cash & bank balance", (k) => opening[k], "grand");
  const sec = (name: "operating" | "investing" | "financing", title: string) => {
    S.head(title);
    const labels = [...new Set(lines.filter((l) => l.section === name).map((l) => l.label))];
    for (const lb of labels) S.add(lb, (k) => lines.filter((l) => "c" + l.company_id === k && l.label === lb).reduce((s, l) => s + l.amount, 0), "", 1);
    S.add(`Net cash from ${name} activities`, (k) => lines.filter((l) => "c" + l.company_id === k && l.section === name).reduce((s, l) => s + l.amount, 0), "total");
  };
  sec("operating", "Operating activities"); sec("investing", "Investing activities"); sec("financing", "Financing activities");
  const inflow = (k: string) => lines.filter((l) => "c" + l.company_id === k && l.amount > 0).reduce((s, l) => s + l.amount, 0);
  const outflow = (k: string) => lines.filter((l) => "c" + l.company_id === k && l.amount < 0).reduce((s, l) => s - l.amount, 0);
  S.head("Summary");
  S.add("Total cash inflow", inflow, "", 1);
  S.add("Total cash outflow", (k) => -outflow(k), "", 1);
  const net = (k: string) => lines.filter((l) => "c" + l.company_id === k).reduce((s, l) => s + l.amount, 0);
  S.add("Net cash movement", net, "total");
  S.add("Closing cash & bank balance", (k) => opening[k] + net(k), "grand");
  const closing = await cashBalance(c, ids, to);
  const calc = cols.reduce((s, col) => s + opening[col.key] + net(col.key), 0);
  return { title: "Cash Flow Statement", subtitle: `${from} to ${to} · ${await scopeLabel(c, ids, u.companyIds.length)} · internal transfers excluded`, columns: S.columns, rows: S.rows, meta: { from, to, reconciles: Math.abs(closing - calc) < 0.005 } };
}

// ---------- Dashboard ----------
export async function dashboard(c: Client, u: SessionUser, p: Params) {
  const ids = scopeIds(u, p.company);
  const r0 = range(p);
  const from = r0.from, to = r0.to > today() && r0.from <= today() ? today() : r0.to; // never show future months as zeros
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const prevTo = addDays(from, -1), prevFrom = addDays(from, -days);
  const [cur, prev] = [pl(await balances(c, ids, from, to)), pl(await balances(c, ids, prevFrom, prevTo))];
  const posNow = await balances(c, ids, null, to), posPrev = await balances(c, ids, null, prevTo);
  const pos = (rows: BalRow[]) => ({
    cash: money(sum(rows, (r) => r.subtype === "cash", dr)), bank: money(sum(rows, (r) => r.subtype === "bank", dr)),
    ar: money(sum(rows, (r) => r.subtype === "receivable", dr)), ap: money(sum(rows, (r) => r.subtype === "payable", cr)),
  });
  const a = pos(posNow), b = pos(posPrev);
  // monthly growth: current calendar month (to-month) vs the month before
  const mStart = `${to.slice(0, 7)}-01`, lmStart = addMonths(mStart, -1);
  const m1 = pl(await balances(c, ids, mStart, to)), m0 = pl(await balances(c, ids, lmStart, monthEnd(lmStart.slice(0, 7))));
  const growth = m0.income > 0 ? ((m1.income - m0.income) / m0.income) * 100 : m1.income > 0 ? 100 : 0;
  const kpi = (key: string, label: string, value: number, previous: number, good: "up" | "down" = "up") => ({
    key, label, value: money(value), previous: money(previous), changePct: previous ? money(((value - previous) / Math.abs(previous)) * 100) : value ? 100 : 0, good,
  });
  const kpis = [
    kpi("revenue", "Total Revenue", cur.income, prev.income),
    kpi("expenses", "Total Expenses", cur.expenses, prev.expenses, "down"),
    kpi("profit", "Net Profit", cur.net, prev.net),
    kpi("cash", "Available Cash", a.cash, b.cash),
    kpi("bank", "Bank Balance", a.bank, b.bank),
    kpi("ar", "Accounts Receivable", a.ar, b.ar, "down"),
    kpi("ap", "Accounts Payable", a.ap, b.ap, "down"),
    { key: "growth", label: "Monthly Growth", value: money(growth), previous: money(m0.income), changePct: money(growth), good: "up", isPct: true, thisMonth: m1.income },
  ];
  // monthly series over a window
  const winStart = days >= 150 ? from : addMonths(mStart, -5);
  const monthly = await balances(c, ids, winStart, to, true);
  const months: string[] = [];
  for (let m = winStart.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m + "-01", 1).slice(0, 7)) months.push(m);
  const series = months.map((m) => { const x = pl(monthly.filter((r) => r.month === m)); return { month: m, revenue: x.income, expenses: x.expenses, profit: x.net }; });
  const cf = await cashFlowLines(c, ids, winStart, to);
  const cashSeries = months.map((m) => {
    const L = cf.filter((l) => l.month === m);
    const f = (s: string) => money(L.filter((l) => l.section === s).reduce((t, l) => t + l.amount, 0));
    return { month: m, operating: f("operating"), investing: f("investing"), financing: f("financing"), inflow: money(L.filter((l) => l.amount > 0).reduce((t, l) => t + l.amount, 0)), outflow: money(L.filter((l) => l.amount < 0).reduce((t, l) => t - l.amount, 0)) };
  });
  const names = await companyNames(c, ids);
  const perCompanyRows = await balances(c, ids, from, to);
  const companies = names.map((n) => ({ id: n.id, name: n.name, ...pl(perCompanyRows.filter((r) => r.company_id === n.id)) }));
  const expByCat = new Map<string, number>();
  for (const r of perCompanyRows.filter((r) => r.type === "expense")) expByCat.set(r.name, (expByCat.get(r.name) || 0) + dr(r));
  const catArr = [...expByCat.entries()].filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
  const top = catArr.slice(0, 7).map(([name, value]) => ({ name, value: money(value) }));
  const rest = catArr.slice(7).reduce((s, [, v]) => s + v, 0);
  if (rest > 0) top.push({ name: "Others", value: money(rest) });
  // operational alerts
  const od = await q1(c, `SELECT count(*)::int n, COALESCE(SUM(total-amount_paid),0) amt FROM invoices WHERE company_id=ANY($1) AND status='posted' AND due_date<CURRENT_DATE AND amount_paid<total`, [ids]);
  const dueBills = await q(c, `SELECT b.bill_no, v.name vendor, b.due_date, (b.total-b.tds_amount-b.amount_paid) AS balance, ${STATUS_SQL("b", true)} status FROM bills b JOIN vendors v ON v.id=b.vendor_id
    WHERE b.company_id=ANY($1) AND b.status='posted' AND b.amount_paid < b.total-b.tds_amount AND b.due_date <= CURRENT_DATE + 14 ORDER BY b.due_date LIMIT 6`, [ids]);
  const pending = await q1(c, "SELECT count(*)::int n, COALESCE(SUM(amount),0) amt FROM transactions WHERE company_id=ANY($1) AND status='pending_approval'", [ids]);
  const bud = await budgetVsActual(c, u, { ...p, fy: fyOf(to) });
  const over = bud.rows.filter((r) => r.utilization > 100 || r.utilization >= 90).slice(0, 5);
  return { range: { from, to, prevFrom, prevTo, days }, kpis, series, cashSeries, companies, expenseByCategory: top,
    alerts: { overdueInvoices: od, upcomingBills: dueBills, pendingApprovals: pending, budgetWarnings: over }, scope: names.map((n) => n.name) };
}

// ---------- Budgets ----------
export async function budgetVsActual(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company);
  const fy = p.fy || fyOf(today());
  const { start } = fyRange(fy);
  const rows = await q<any>(c,
    `SELECT b.id, co.name AS company, ac.name AS category, b.department, b.month, b.amount AS budget,
       COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id
         WHERE l.account_id=ac.account_id AND e.entry_date BETWEEN
           CASE WHEN b.month IS NULL THEN $2::date ELSE make_date(CASE WHEN b.month>=4 THEN left($3,4)::int ELSE left($3,4)::int+1 END, b.month, 1) END
           AND CASE WHEN b.month IS NULL THEN ($2::date + interval '1 year - 1 day')::date ELSE (make_date(CASE WHEN b.month>=4 THEN left($3,4)::int ELSE left($3,4)::int+1 END, b.month, 1) + interval '1 month - 1 day')::date END),0) AS actual
     FROM budgets b JOIN account_categories ac ON ac.id=b.category_id JOIN companies co ON co.id=b.company_id
     WHERE b.company_id=ANY($1) AND b.fy=$3 ORDER BY co.id, ac.name, b.month NULLS FIRST`, [ids, start, fy]);
  const MN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const out = rows.map((r) => {
    const util = r.budget ? (r.actual / r.budget) * 100 : r.actual > 0 ? 999 : 0;
    return { id: r.id, company: r.company, category: r.category, department: r.department || "—", period: r.month ? `${MN[r.month]}` : `FY ${fy}`, budget: money(r.budget), actual: money(r.actual), remaining: money(r.budget - r.actual), utilization: money(util), status: util > 100 ? "Over budget" : util >= 90 ? "Warning (≥90%)" : "Within budget" };
  });
  return { title: "Budget vs Actual", subtitle: `Financial year ${fy}`, columns: [
    { key: "company", label: "Company" }, { key: "category", label: "Category" }, { key: "department", label: "Department" }, { key: "period", label: "Period" },
    { key: "budget", label: "Budget", kind: "money" }, { key: "actual", label: "Actual", kind: "money" }, { key: "remaining", label: "Remaining", kind: "money" },
    { key: "utilization", label: "Utilisation %", kind: "pct" }, { key: "status", label: "Status" }], rows: out, meta: { fy } };
}

// ---------- Tabular reports ----------
export async function incomeReport(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company); const { from, to } = range(p);
  const rows = await q<any>(c, `SELECT e.entry_date AS date, co.name AS company, e.entry_no, a.name AS category, e.source_type AS source, e.memo, (l.credit-l.debit) AS amount
    FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id JOIN companies co ON co.id=e.company_id
    WHERE e.company_id=ANY($1) AND a.type='income' AND e.entry_date BETWEEN $2 AND $3 AND ($4::int IS NULL OR a.id=(SELECT account_id FROM account_categories WHERE id=$4))
    ORDER BY e.entry_date DESC, e.id DESC`, [ids, from, to, p.category ? +p.category : null]);
  return { title: "Income Report", subtitle: `${from} to ${to} · ${await scopeLabel(c, ids, u.companyIds.length)} · net of discounts/returns`, columns: [
    { key: "date", label: "Date", kind: "date" }, { key: "company", label: "Company" }, { key: "entry_no", label: "Entry" }, { key: "category", label: "Account" }, { key: "source", label: "Source" }, { key: "memo", label: "Narration" }, { key: "amount", label: "Amount", kind: "money" }],
    rows: rows.map((r) => ({ ...r, amount: money(r.amount) })), meta: { total: money(rows.reduce((s, r) => s + r.amount, 0)) } };
}
export async function expenseReport(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company); const { from, to } = range(p);
  const rows = await q<any>(c, `SELECT e.entry_date AS date, co.name AS company, e.entry_no, a.name AS category, e.source_type AS source, e.memo, (l.debit-l.credit) AS amount
    FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id JOIN companies co ON co.id=e.company_id
    WHERE e.company_id=ANY($1) AND a.type='expense' AND e.entry_date BETWEEN $2 AND $3 AND ($4::int IS NULL OR a.id=(SELECT account_id FROM account_categories WHERE id=$4))
    ORDER BY e.entry_date DESC, e.id DESC`, [ids, from, to, p.category ? +p.category : null]);
  return { title: "Expense Report", subtitle: `${from} to ${to} · ${await scopeLabel(c, ids, u.companyIds.length)}`, columns: [
    { key: "date", label: "Date", kind: "date" }, { key: "company", label: "Company" }, { key: "entry_no", label: "Entry" }, { key: "category", label: "Account" }, { key: "source", label: "Source" }, { key: "memo", label: "Narration" }, { key: "amount", label: "Amount", kind: "money" }],
    rows: rows.map((r) => ({ ...r, amount: money(r.amount) })), meta: { total: money(rows.reduce((s, r) => s + r.amount, 0)) } };
}
export async function receivables(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company);
  const rows = await q<any>(c, `SELECT * FROM (SELECT i.id, co.name AS company, i.invoice_no AS number, cu.name AS party, i.issue_date, i.due_date, i.total, i.amount_paid AS paid, (i.total-i.amount_paid) AS balance,
      ${STATUS_SQL("i")} AS status, GREATEST(CURRENT_DATE - i.due_date,0) AS days_overdue
    FROM invoices i JOIN customers cu ON cu.id=i.customer_id JOIN companies co ON co.id=i.company_id WHERE i.company_id=ANY($1) AND i.status<>'draft') x
    WHERE ($2::text IS NULL OR status=$2) ORDER BY due_date`, [ids, p.status || null]);
  const outstanding = rows.filter((r) => r.status !== "voided" && r.status !== "paid").reduce((s, r) => s + r.balance, 0);
  return { title: "Accounts Receivable", subtitle: `Outstanding ${await scopeLabel(c, ids, u.companyIds.length)}`, columns: [
    { key: "company", label: "Company" }, { key: "number", label: "Invoice" }, { key: "party", label: "Customer" }, { key: "issue_date", label: "Issued", kind: "date" }, { key: "due_date", label: "Due", kind: "date" },
    { key: "total", label: "Invoice Amount", kind: "money" }, { key: "paid", label: "Received", kind: "money" }, { key: "balance", label: "Balance", kind: "money" }, { key: "days_overdue", label: "Days Overdue", kind: "int" }, { key: "status", label: "Status" }],
    rows, meta: { outstanding: money(outstanding) } };
}
export async function payables(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company);
  const rows = await q<any>(c, `SELECT * FROM (SELECT b.id, co.name AS company, b.bill_no AS number, v.name AS party, b.bill_date AS issue_date, b.due_date, (b.total-b.tds_amount) AS total, b.amount_paid AS paid, (b.total-b.tds_amount-b.amount_paid) AS balance,
      ${STATUS_SQL("b", true)} AS status, GREATEST(CURRENT_DATE - b.due_date,0) AS days_overdue
    FROM bills b JOIN vendors v ON v.id=b.vendor_id JOIN companies co ON co.id=b.company_id WHERE b.company_id=ANY($1) AND b.status<>'draft') x
    WHERE ($2::text IS NULL OR status=$2) ORDER BY due_date`, [ids, p.status || null]);
  const outstanding = rows.filter((r) => r.status !== "voided" && r.status !== "paid").reduce((s, r) => s + r.balance, 0);
  return { title: "Accounts Payable", subtitle: `Outstanding ${await scopeLabel(c, ids, u.companyIds.length)}`, columns: [
    { key: "company", label: "Company" }, { key: "number", label: "Bill" }, { key: "party", label: "Vendor" }, { key: "issue_date", label: "Bill Date", kind: "date" }, { key: "due_date", label: "Due", kind: "date" },
    { key: "total", label: "Payable", kind: "money" }, { key: "paid", label: "Paid", kind: "money" }, { key: "balance", label: "Balance", kind: "money" }, { key: "days_overdue", label: "Days Overdue", kind: "int" }, { key: "status", label: "Status" }],
    rows, meta: { outstanding: money(outstanding) } };
}
export async function trialBalance(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company); const asOf = p.asOf || p.to || today();
  const rows = (await balances(c, ids, null, asOf)).sort((a, b) => a.code.localeCompare(b.code));
  const m = new Map<string, any>();
  for (const r of rows) { const k = r.code + r.name; const x = m.get(k) || { code: r.code, account: r.name, type: r.type, debit: 0, credit: 0 }; x.debit += r.debit; x.credit += r.credit; m.set(k, x); }
  const out = [...m.values()].map((x) => { const n = x.debit - x.credit; return { code: x.code, account: x.account, type: x.type, debit: money(n > 0 ? n : 0), credit: money(n < 0 ? -n : 0) }; });
  const td = money(out.reduce((s, r) => s + r.debit, 0)), tc = money(out.reduce((s, r) => s + r.credit, 0));
  out.push({ code: "", account: "TOTAL", type: "", debit: td, credit: tc, _style: "grand" } as any);
  return { title: "Trial Balance", subtitle: `As of ${asOf} · ${await scopeLabel(c, ids, u.companyIds.length)}`, columns: [{ key: "code", label: "Code" }, { key: "account", label: "Account" }, { key: "type", label: "Type" }, { key: "debit", label: "Debit", kind: "money" }, { key: "credit", label: "Credit", kind: "money" }], rows: out, meta: { balanced: td === tc, debit: td, credit: tc } };
}
export async function companyComparison(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company); const { from, to } = range(p);
  const names = await companyNames(c, ids);
  const per = await balances(c, ids, from, to), pos = await balances(c, ids, null, to);
  const rows = names.map((n) => {
    const x = pl(per.filter((r) => r.company_id === n.id)); const ps = pos.filter((r) => r.company_id === n.id);
    return { company: n.name, revenue: x.income, expenses: x.expenses, profit: x.net, margin: x.income ? money((x.net / x.income) * 100) : 0,
      cash: money(sum(ps, (r) => ["cash", "bank"].includes(r.subtype), dr)), receivables: money(sum(ps, (r) => r.subtype === "receivable", dr)), payables: money(sum(ps, (r) => r.subtype === "payable", cr)) };
  });
  const T = (k: string) => money(rows.reduce((s, r: any) => s + r[k], 0));
  rows.push({ company: "GROUP TOTAL", revenue: T("revenue"), expenses: T("expenses"), profit: T("profit"), margin: T("revenue") ? money((T("profit") / T("revenue")) * 100) : 0, cash: T("cash"), receivables: T("receivables"), payables: T("payables"), _style: "grand" } as any);
  return { title: "Company Comparison", subtitle: `${from} to ${to}`, columns: [{ key: "company", label: "Company" }, { key: "revenue", label: "Revenue", kind: "money" }, { key: "expenses", label: "Expenses", kind: "money" }, { key: "profit", label: "Net Profit", kind: "money" }, { key: "margin", label: "Margin %", kind: "pct" }, { key: "cash", label: "Cash + Bank", kind: "money" }, { key: "receivables", label: "Receivables", kind: "money" }, { key: "payables", label: "Payables", kind: "money" }], rows };
}
async function periodSummary(c: Client, u: SessionUser, p: Params, mode: "month" | "year"): Promise<Report> {
  const ids = scopeIds(u, p.company);
  const r = mode === "year" ? { from: fyRange(fyOf(addMonths(today(), -24))).start, to: fyRange(fyOf(today())).end } : range(p);
  const bal = await balances(c, ids, r.from, r.to, true);
  const cf = await cashFlowLines(c, ids, r.from, r.to);
  const key = (m: string) => (mode === "year" ? "FY " + fyOf(m + "-01") : m);
  const keys = [...new Set([...bal.map((b) => key(b.month!)), ...cf.map((l) => key(l.month))])].sort();
  let running = await cashBalance(c, ids, r.from, true);
  const rows = keys.map((k) => {
    const x = pl(bal.filter((b) => key(b.month!) === k)); const L = cf.filter((l) => key(l.month) === k);
    const inflow = money(L.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0)), outflow = money(L.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0));
    const opening = running; running = money(running + inflow - outflow);
    return { period: k, revenue: x.income, expenses: x.expenses, profit: x.net, inflow, outflow, opening, closing: running };
  });
  return { title: mode === "year" ? "Annual Financial Summary" : "Monthly Financial Summary", subtitle: `${r.from} to ${r.to} · ${await scopeLabel(c, ids, u.companyIds.length)}`, columns: [{ key: "period", label: mode === "year" ? "Financial Year" : "Month" }, { key: "revenue", label: "Revenue", kind: "money" }, { key: "expenses", label: "Expenses", kind: "money" }, { key: "profit", label: "Net Profit", kind: "money" }, { key: "opening", label: "Opening Cash", kind: "money" }, { key: "inflow", label: "Cash In", kind: "money" }, { key: "outflow", label: "Cash Out", kind: "money" }, { key: "closing", label: "Closing Cash", kind: "money" }], rows };
}
export const monthlySummary = (c: Client, u: SessionUser, p: Params) => periodSummary(c, u, p, "month");
export const annualSummary = (c: Client, u: SessionUser, p: Params) => periodSummary(c, u, { ...p, from: undefined, to: undefined }, "year");

export async function taxReport(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company); const { from, to } = range(p);
  const names = await companyNames(c, ids);
  const cols = names.map((n) => ({ key: "c" + n.id, label: n.name }));
  const rows = await q<any>(c, `SELECT a.company_id, a.subtype, e.source_type, SUM(l.debit) debit, SUM(l.credit) credit FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
    WHERE a.company_id=ANY($1) AND e.entry_date BETWEEN $2 AND $3 AND a.subtype IN ('output_cgst','output_sgst','output_igst','input_cgst','input_sgst','input_igst','tds_payable') GROUP BY 1,2,3`, [ids, from, to]);
  const close = await balances(c, ids, null, to);
  const S = new Stmt(cols);
  const accr = (kind: string, side: "o" | "i") => (k: string) => rows.filter((r) => "c" + r.company_id === k && r.subtype === `${side === "o" ? "output" : "input"}_${kind}` && r.source_type !== "tax").reduce((s, r) => s + (side === "o" ? r.credit - r.debit : r.debit - r.credit), 0);
  S.head("Output GST (collected on sales, net of returns)");
  for (const k of ["cgst", "sgst", "igst"]) S.add(k.toUpperCase(), accr(k, "o"), "", 1);
  S.add("Total Output GST", (k) => ["cgst", "sgst", "igst"].reduce((s, x) => s + accr(x, "o")(k), 0), "sub");
  S.head("Input GST (paid on purchases)");
  for (const k of ["cgst", "sgst", "igst"]) S.add(k.toUpperCase(), accr(k, "i"), "", 1);
  S.add("Total Input Tax Credit", (k) => ["cgst", "sgst", "igst"].reduce((s, x) => s + accr(x, "i")(k), 0), "sub");
  S.add("Net GST payable / (credit)", (k) => ["cgst", "sgst", "igst"].reduce((s, x) => s + accr(x, "o")(k) - accr(x, "i")(k), 0), "total");
  const settled = (src: string) => (k: string) => rows.filter((r) => "c" + r.company_id === k && r.source_type === "tax" && r.subtype.startsWith("output_") && r.subtype !== "tds_payable").reduce((s, r) => s + r.debit - r.credit, 0);
  S.add("GST paid / set off in period", settled("tax"), "", 1);
  S.add("Closing GST liability (output − input, all time)", (k) => sum(close.filter((r) => "c" + r.company_id === k), (r) => r.subtype.startsWith("output_"), cr) - sum(close.filter((r) => "c" + r.company_id === k), (r) => r.subtype.startsWith("input_"), dr), "grand");
  S.head("TDS");
  S.add("TDS deducted in period", (k) => rows.filter((r) => "c" + r.company_id === k && r.subtype === "tds_payable" && r.source_type !== "tax").reduce((s, r) => s + r.credit - r.debit, 0), "", 1);
  S.add("TDS deposited in period", (k) => rows.filter((r) => "c" + r.company_id === k && r.subtype === "tds_payable" && r.source_type === "tax").reduce((s, r) => s + r.debit - r.credit, 0), "", 1);
  S.add("TDS payable (closing)", (k) => sum(close.filter((r) => "c" + r.company_id === k), (r) => r.subtype === "tds_payable", cr), "grand");
  return { title: "Tax Summary (GST & TDS)", subtitle: `${from} to ${to} · Computed from posted ledger entries — for accountant verification, not an automatic GST return`, columns: S.columns, rows: S.rows };
}

export async function payrollReport(c: Client, u: SessionUser, p: Params): Promise<Report> {
  if (!can(u, "payroll.read")) throw new HttpError(403, "Payroll is restricted to authorised users");
  const ids = scopeIds(u, p.company); const { from, to } = range(p);
  const rows = await q<any>(c, `SELECT pr.month, co.name AS company, em.emp_code, em.name AS employee, pi.basic, pi.allowances, pi.deductions, pi.advance_recovery AS advance, pi.net, pi.paid_amount AS paid, pr.status
    FROM payroll_items pi JOIN payroll pr ON pr.id=pi.payroll_id JOIN employees em ON em.id=pi.employee_id JOIN companies co ON co.id=pr.company_id
    WHERE pr.company_id=ANY($1) AND pr.status<>'voided' AND pr.month BETWEEN $2 AND $3 ORDER BY pr.month DESC, co.id, em.emp_code`, [ids, from.slice(0, 7), to.slice(0, 7)]);
  return { title: "Payroll Report", subtitle: `${from.slice(0, 7)} to ${to.slice(0, 7)} · ${await scopeLabel(c, ids, u.companyIds.length)}`, columns: [
    { key: "month", label: "Month" }, { key: "company", label: "Company" }, { key: "emp_code", label: "Code" }, { key: "employee", label: "Employee" }, { key: "basic", label: "Basic", kind: "money" }, { key: "allowances", label: "Allowances", kind: "money" },
    { key: "deductions", label: "Deductions", kind: "money" }, { key: "advance", label: "Advance Rec.", kind: "money" }, { key: "net", label: "Net Salary", kind: "money" }, { key: "paid", label: "Paid", kind: "money" }, { key: "status", label: "Status" }], rows };
}


// ---------- Product / project / course profitability (uses the "project" tag on income, expenses, invoices) ----------
export async function byProject(c: Client, u: SessionUser, p: Params): Promise<Report> {
  const ids = scopeIds(u, p.company); const { from, to } = range(p);
  const rows = await q<any>(c, `
    WITH x AS (
      SELECT company_id, COALESCE(NULLIF(project,''),'(untagged)') AS project, (amount - tax_amount) AS revenue, 0::numeric AS refunds, 0::numeric AS expenses FROM transactions
        WHERE kind='income' AND status='posted' AND company_id=ANY($1) AND txn_date BETWEEN $2 AND $3
      UNION ALL
      SELECT company_id, COALESCE(NULLIF(project,''),'(untagged)'), 0, (amount - tax_amount), 0 FROM transactions
        WHERE kind='refund' AND status='posted' AND company_id=ANY($1) AND txn_date BETWEEN $2 AND $3
      UNION ALL
      SELECT company_id, COALESCE(NULLIF(project,''),'(untagged)'), 0, 0, (amount - tax_amount) FROM transactions
        WHERE kind='expense' AND status='posted' AND company_id=ANY($1) AND txn_date BETWEEN $2 AND $3
      UNION ALL
      SELECT company_id, COALESCE(NULLIF(project,''),'(untagged)'), (subtotal - discount_total), 0, 0 FROM invoices
        WHERE status='posted' AND company_id=ANY($1) AND issue_date BETWEEN $2 AND $3)
    SELECT co.name AS company, x.project, SUM(revenue) AS revenue, SUM(refunds) AS refunds, SUM(expenses) AS expenses, SUM(revenue) - SUM(refunds) - SUM(expenses) AS net
    FROM x JOIN companies co ON co.id=x.company_id GROUP BY co.id, co.name, x.project ORDER BY co.id, net DESC`, [ids, from, to]);
  return { title: "Product / Project / Course Performance", subtitle: `${from} to ${to} · based on the Product/Project/Course tag of income, expenses and invoices · excludes GST`, columns: [
    { key: "company", label: "Company" }, { key: "project", label: "Product / Project / Course" }, { key: "revenue", label: "Revenue", kind: "money" }, { key: "refunds", label: "Refunds", kind: "money" }, { key: "expenses", label: "Direct expenses", kind: "money" }, { key: "net", label: "Net", kind: "money" }],
    rows: rows.map((r) => ({ ...r, revenue: money(r.revenue), refunds: money(r.refunds), expenses: money(r.expenses), net: money(r.net) })) };
}

export const REPORTS: Record<string, (c: Client, u: SessionUser, p: Params) => Promise<Report>> = {
  income: incomeReport, expense: expenseReport, "profit-loss": profitLoss, "balance-sheet": balanceSheet, "cash-flow": cashFlow, receivables, payables,
  tax: taxReport, payroll: payrollReport, "budget-vs-actual": budgetVsActual, "company-comparison": companyComparison, "by-project": byProject, monthly: monthlySummary, annual: annualSummary, "trial-balance": trialBalance,
};
