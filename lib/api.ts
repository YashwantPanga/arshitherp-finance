// REST API: one tiny router so every endpoint shares auth, CSRF, permission and error handling.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { z } from "zod";
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { Client, HttpError, SessionUser, q, q1, sys, tx } from "./db";
import { COOKIE, currentUser, finishReset, hashPassword, login, logout, requireUser, sha, startReset, validatePassword } from "./auth";
import { can, need, permsOf, presetRange, scopeIds, today, writeCompany, nextNo, fyOf } from "./core";
import { audit } from "./ledger";
import { approveTxn, createTxn, deleteDraftTxn, runRecurring, updateTxn, voidTxn } from "./txn";
import { deleteDraftBill, deleteDraftInvoice, issueInvoice, postBill, recordPayment, saveBill, saveInvoice, STATUS_SQL, voidBill, voidInvoice, voidPayment } from "./docs";
import { addAdvance, adjustOpening, createBankAccount, createPayroll, createTaxRecord, payPayroll, postPayroll, reconcile, unreconciledLines, updatePayrollItem, verifyTaxRecord, voidTaxRecord } from "./misc";
import { dashboard, REPORTS } from "./reports";
import { invoicePdf, payslipPdf, toCsv, toPdf, toXlsx } from "./export";
import { onboardCompany } from "./setup";

type Ctx = { req: NextRequest; u: SessionUser; p: Record<string, string>; qs: Record<string, string>; body: any; run: <T>(fn: (c: Client) => Promise<T>) => Promise<T> };
type H = (x: Ctx) => Promise<any>;
interface Route { method: string; re: RegExp; keys: string[]; h: H; pub?: boolean }
const routes: Route[] = [];
function R(method: string, pattern: string, h: H, pub = false) {
  const keys: string[] = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, h, pub });
}
const GET = (p: string, h: H) => R("GET", p, h), POST = (p: string, h: H, pub = false) => R("POST", p, h, pub), PUT = (p: string, h: H) => R("PUT", p, h), DEL = (p: string, h: H) => R("DELETE", p, h);
const id = (x: Ctx, k = "id") => { const n = Number(x.p[k]); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid id"); return n; };
const paging = (qs: Record<string, string>) => { const size = Math.min(200, Math.max(1, +qs.pageSize || 25)); const page = Math.max(1, +qs.page || 1); return { size, page, off: (page - 1) * size }; };
const like = (s: string) => `%${s.replace(/[%_\\]/g, "\\$&")}%`;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const rp = (qs: Record<string, string>) => ({ company: qs.company, from: qs.from, to: qs.to, preset: qs.preset, asOf: qs.asOf, category: qs.category, group: qs.group, status: qs.status, fy: qs.fy });

// ===================== AUTH =====================
POST("/auth/login", async ({ req, body }) => {
  const z1 = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(body);
  if (!z1.success) throw new HttpError(400, "Email and password are required");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0];
  const { token, expires } = await login(z1.data.email, z1.data.password, ip, req.headers.get("user-agent") || undefined);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires });
  return { ok: true };
}, true);
POST("/auth/logout", async () => { await logout(); (await cookies()).delete(COOKIE); return { ok: true }; }, true);
GET("/auth/me", async ({ u }) => ({ user: { id: u.id, name: u.name, email: u.email, role: u.role, companyIds: u.companyIds, perms: permsOf(u.role) } }));
POST("/auth/forgot", async ({ body }) => {
  const e = z.string().email().safeParse(body?.email);
  if (e.success) { const t = await startReset(e.data); return { ok: true, message: "If that email exists, a reset link has been issued.", devToken: t }; }
  return { ok: true, message: "If that email exists, a reset link has been issued." };
}, true);
POST("/auth/reset", async ({ body }) => { await finishReset(String(body?.token || ""), String(body?.password || "")); return { ok: true }; }, true);
POST("/auth/password", async ({ u, body }) => {
  validatePassword(String(body?.password || ""));
  const row = await sys((c) => q1(c, "SELECT password_hash FROM user_profiles WHERE id=$1", [u.id]));
  const bcrypt = await import("bcryptjs");
  if (!(await bcrypt.compare(String(body.current || ""), row!.password_hash))) throw new HttpError(400, "Current password is incorrect");
  const nh = await hashPassword(body.password);
  await sys((c) => c.query("UPDATE user_profiles SET password_hash=$2 WHERE id=$1", [u.id, nh]));
  return { ok: true };
});
GET("/auth/sessions", async ({ u }) => sys((c) => q(c, "SELECT id,user_agent,ip,created_at,last_seen,expires_at FROM sessions WHERE user_id=$1 AND NOT revoked AND expires_at>now() ORDER BY last_seen DESC", [u.id])));
POST("/auth/sessions/:id/revoke", async (x) => { await sys((c) => c.query("UPDATE sessions SET revoked=true WHERE id=$1 AND user_id=$2", [id(x), x.u.id])); return { ok: true }; });
POST("/auth/sessions/revoke-others", async ({ u }) => { await sys((c) => c.query("UPDATE sessions SET revoked=true WHERE user_id=$1 AND id<>$2", [u.id, (u as any).sessionId])); return { ok: true }; });

// ===================== META (lookups for forms & the company switcher) =====================
GET("/meta", async ({ u, run }) => run(async (c) => {
  const [companies, banks, categories, customers, vendors, periods] = await Promise.all([
    q(c, "SELECT id,code,name,legal_name,business_type,gstin,pan,address,city,state,state_code,pincode,phone,email,logo_text,brand_color,invoice_prefix,bill_prefix,payment_terms,bank_details,gst_registered,features,active FROM companies ORDER BY id"),
    q(c, `SELECT ba.id,ba.company_id,ba.name,ba.bank_name,ba.account_type,ba.account_ref,ba.opening_balance,ba.active, COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_entry_lines l WHERE l.account_id=ba.account_id),0) AS balance FROM bank_accounts ba ORDER BY ba.company_id, ba.id`),
    q(c, "SELECT id,company_id,kind,name,account_id,active FROM account_categories ORDER BY company_id,kind,name"),
    q(c, "SELECT id,company_id,name,state_code,credit_days FROM customers WHERE active ORDER BY name"),
    q(c, "SELECT id,company_id,name,state_code,credit_days FROM vendors WHERE active ORDER BY name"),
    q(c, "SELECT id,company_id,label,start_date,end_date,status FROM financial_periods ORDER BY start_date DESC"),
  ]);
  const employees = can(u, "payroll.read") ? await q(c, "SELECT id,company_id,emp_code,name FROM employees WHERE active ORDER BY name") : [];
  return { user: { id: u.id, name: u.name, email: u.email, role: u.role, perms: permsOf(u.role), companyIds: u.companyIds }, companies, banks, categories, customers, vendors, employees, periods, today: today(), fy: fyOf(today()) };
}));

// ===================== DASHBOARD & REPORTS =====================
GET("/dashboard", async ({ u, qs, run }) => run((c) => dashboard(c, u, rp(qs))));
GET("/reports/:name", async (x) => { const f = REPORTS[x.p.name]; if (!f) throw new HttpError(404, "Unknown report"); return x.run((c) => f(c, x.u, rp(x.qs))); });
GET("/reports/:name/export", async (x) => {
  const f = REPORTS[x.p.name]; if (!f) throw new HttpError(404, "Unknown report");
  const r = await x.run((c) => f(c, x.u, rp(x.qs)));
  const fmt = x.qs.format || "xlsx", base = `${x.p.name}-${today()}`;
  await x.run((c) => audit(c, x.u, { action: "export", entity: "report", id: x.p.name, note: `${fmt} ${JSON.stringify(rp(x.qs))}` }));
  if (fmt === "csv") return new Response(toCsv(r), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` } });
  if (fmt === "pdf") return new Response(new Uint8Array(await toPdf(r)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
  return new Response(new Uint8Array(await toXlsx(r)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` } });
});

// ===================== TRANSACTIONS (income / expense / refund / banking) =====================
const txnFilter = (u: SessionUser, qs: Record<string, string>) => {
  const ids = scopeIds(u, qs.company);
  const kinds = (qs.kind || "").split(",").filter(Boolean);
  const r = presetRange(qs.preset || "custom", qs.from, qs.to);
  const hasRange = !!(qs.preset || qs.from || qs.to);
  const where = `t.company_id=ANY($1) AND ($2::text[] IS NULL OR t.kind=ANY($2)) AND ($3::text IS NULL OR t.status::text=$3) AND ($4::int IS NULL OR t.category_id=$4)
    AND ($5::date IS NULL OR t.txn_date>=$5) AND ($6::date IS NULL OR t.txn_date<=$6) AND ($7::text IS NULL OR (t.party_name ILIKE $7 OR t.description ILIKE $7 OR t.reference ILIKE $7 OR t.invoice_no ILIKE $7 OR t.txn_no ILIKE $7))
    AND ($8::text IS NULL OR t.payment_method=$8)`;
  const args = [ids, kinds.length ? kinds : null, qs.status || null, qs.category ? +qs.category : null, hasRange ? r.from : null, hasRange ? r.to : null, qs.q ? like(qs.q) : null, qs.method || null];
  return { where, args };
};
const TXN_FROM = `FROM transactions t JOIN companies co ON co.id=t.company_id LEFT JOIN account_categories ac ON ac.id=t.category_id JOIN bank_accounts ba ON ba.id=t.bank_account_id LEFT JOIN bank_accounts tb ON tb.id=t.to_bank_account_id
    LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN vendors v ON v.id=t.vendor_id LEFT JOIN user_names un ON un.id=t.created_by`;
GET("/transactions/export", async (x) => x.run(async (c) => {
  const { where, args } = txnFilter(x.u, x.qs);
  const rows = await q<any>(c, `SELECT t.txn_date AS date, t.txn_no, co.name AS company, t.kind, ac.name AS category, COALESCE(t.party_name, cu.name, v.name) AS party, t.payment_method AS method, t.reference, ba.name AS account,
      (t.amount - t.tax_amount) AS base, t.tax_amount AS tax, t.tds_amount AS tds, t.amount AS total, t.status::text AS status, t.description ${TXN_FROM} WHERE ${where} ORDER BY t.txn_date DESC, t.id DESC LIMIT 20000`, args);
  const label = (x.qs.kind || "all").split(",").join(" / ");
  const report = { title: `${label.charAt(0).toUpperCase() + label.slice(1)} transactions`, subtitle: `${rows.length} records matching the filters on screen`, columns: [
    { key: "date", label: "Date", kind: "date" }, { key: "txn_no", label: "Reference" }, { key: "company", label: "Company" }, { key: "category", label: "Category" }, { key: "party", label: "Party" }, { key: "method", label: "Method" }, { key: "account", label: "Account" },
    { key: "base", label: "Amount", kind: "money" }, { key: "tax", label: "GST", kind: "money" }, { key: "tds", label: "TDS", kind: "money" }, { key: "total", label: "Total", kind: "money" }, { key: "status", label: "Status" }] as any, rows };
  const fmt = x.qs.format || "xlsx", base = `transactions-${today()}`;
  await audit(c, x.u, { action: "export", entity: "report", id: "transactions", note: `${fmt} ${JSON.stringify(x.qs)}` });
  if (fmt === "csv") return new Response(toCsv(report as any), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` } });
  if (fmt === "pdf") return new Response(new Uint8Array(await toPdf(report as any)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
  return new Response(new Uint8Array(await toXlsx(report as any)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` } });
}));
GET("/transactions", async ({ u, qs, run }) => run(async (c) => {
  const { size, off } = paging(qs);
  const { where, args } = txnFilter(u, qs);
  const sort = { date: "t.txn_date", amount: "t.amount", no: "t.txn_no" }[qs.sort || "date"] || "t.txn_date";
  const dir = qs.dir === "asc" ? "ASC" : "DESC";
  const rows = await q(c, `SELECT t.*, co.name AS company_name, ac.name AS category, ba.name AS bank_name, tb.name AS to_bank_name, cu.name AS customer_name, v.name AS vendor_name, un.name AS created_by_name,
      (SELECT count(*)::int FROM attachments a WHERE a.entity_type='transaction' AND a.entity_id=t.id) AS attachments
    ${TXN_FROM}
    WHERE ${where} ORDER BY ${sort} ${dir}, t.id DESC LIMIT ${size} OFFSET ${off}`, args);
  const tot = await q1(c, `SELECT count(*)::int AS n, COALESCE(SUM(amount) FILTER (WHERE status='posted'),0) AS total, COALESCE(SUM(tax_amount) FILTER (WHERE status='posted'),0) AS tax,
      COALESCE(SUM(amount) FILTER (WHERE status='pending_approval'),0) AS pending, count(*) FILTER (WHERE status='pending_approval')::int AS pending_n
    FROM transactions t WHERE ${where}`, args);
  const cats = qs.withCategories ? await q(c, `SELECT ac.name, SUM(t.amount-t.tax_amount) AS value FROM transactions t JOIN account_categories ac ON ac.id=t.category_id WHERE ${where} AND t.status='posted' GROUP BY ac.name ORDER BY 2 DESC LIMIT 8`, args) : [];
  const monthly = qs.withCategories ? await q(c, `SELECT to_char(t.txn_date,'YYYY-MM') AS month, SUM(t.amount-t.tax_amount) AS value FROM transactions t WHERE ${where} AND t.status='posted' GROUP BY 1 ORDER BY 1`, args) : [];
  return { rows, total: tot!.n, summary: tot, byCategory: cats, monthly, page: paging(qs).page, pageSize: size };
}));
POST("/transactions", async ({ u, body, run }) => run((c) => createTxn(c, u, body)));
PUT("/transactions/:id", async (x) => x.run((c) => updateTxn(c, x.u, id(x), x.body)));
POST("/transactions/:id/approve", async (x) => x.run((c) => approveTxn(c, x.u, id(x), true, x.body?.note)).then(() => ({ ok: true })));
POST("/transactions/:id/reject", async (x) => x.run((c) => approveTxn(c, x.u, id(x), false, x.body?.note)).then(() => ({ ok: true })));
POST("/transactions/:id/void", async (x) => x.run((c) => voidTxn(c, x.u, id(x), String(x.body?.reason || ""))).then(() => ({ ok: true })));
DEL("/transactions/:id", async (x) => x.run((c) => deleteDraftTxn(c, x.u, id(x))).then(() => ({ ok: true })));
POST("/transactions/run-recurring", async (x) => ({ created: await x.run((c) => runRecurring(c, x.u, scopeIds(x.u, x.qs.company))) }));
GET("/transactions/:id", async (x) => x.run(async (c) => {
  const t = await q1(c, "SELECT t.*, (SELECT json_agg(a ORDER BY a.id) FROM (SELECT id,filename,mime,size,created_at FROM attachments WHERE entity_type='transaction' AND entity_id=t.id) a) AS files FROM transactions t WHERE t.id=$1", [id(x)]);
  if (!t) throw new HttpError(404, "Not found");
  const history = await q(c, "SELECT ts,user_email,action,before,after,note FROM audit_logs WHERE entity_type='transaction' AND entity_id=$1 ORDER BY ts", [String(t.id)]);
  return { ...t, history };
}));

// ===================== INVOICES / BILLS / PAYMENTS =====================
const listDocs = (kind: "invoice" | "bill") => async ({ u, qs, run }: Ctx) => run(async (c) => {
  const ids = scopeIds(u, qs.company); const { size, off, page } = paging(qs);
  const isI = kind === "invoice", T = isI ? "invoices" : "bills", P = isI ? "customers" : "vendors", pk = isI ? "customer_id" : "vendor_id", no = isI ? "invoice_no" : "bill_no", dt = isI ? "issue_date" : "bill_date";
  const base = `SELECT x.*, co.name AS company_name, p.name AS party, ${isI ? "x.total" : "x.total - x.tds_amount"} AS payable, (${isI ? "x.total" : "x.total - x.tds_amount"} - x.amount_paid) AS balance, ${STATUS_SQL("x", !isI)} AS pay_status,
      GREATEST(CURRENT_DATE - x.due_date,0) AS days_overdue FROM ${T} x JOIN ${P} p ON p.id=x.${pk} JOIN companies co ON co.id=x.company_id WHERE x.company_id=ANY($1)`;
  const filter = `WHERE ($2::text IS NULL OR pay_status=$2) AND ($3::text IS NULL OR ${no} ILIKE $3 OR party ILIKE $3) AND ($4::date IS NULL OR ${dt}>=$4) AND ($5::date IS NULL OR ${dt}<=$5) AND ($6::int IS NULL OR ${pk}=$6)`;
  const args = [ids, qs.status || null, qs.q ? like(qs.q) : null, dateRe.test(qs.from || "") ? qs.from : null, dateRe.test(qs.to || "") ? qs.to : null, qs.party ? +qs.party : null];
  const rows = await q(c, `SELECT * FROM (${base}) s ${filter} ORDER BY ${dt} DESC, id DESC LIMIT ${size} OFFSET ${off}`, args);
  const s = await q1(c, `SELECT count(*)::int n, COALESCE(SUM(balance) FILTER (WHERE pay_status IN ('unpaid','partially_paid','overdue')),0) AS outstanding,
      COALESCE(SUM(balance) FILTER (WHERE pay_status='overdue'),0) AS overdue, count(*) FILTER (WHERE pay_status='overdue')::int AS overdue_n,
      COALESCE(SUM(payable) FILTER (WHERE status<>'voided' AND status<>'draft'),0) AS billed, COALESCE(SUM(amount_paid) FILTER (WHERE status<>'voided'),0) AS paid
    FROM (${base}) s ${filter}`, args);
  return { rows, total: s!.n, summary: s, page, pageSize: size };
});
GET("/invoices", listDocs("invoice")); GET("/bills", listDocs("bill"));
const getDoc = (kind: "invoice" | "bill") => async (x: Ctx) => x.run(async (c) => {
  const isI = kind === "invoice", T = isI ? "invoices" : "bills";
  const d = await q1(c, `SELECT x.*, ${STATUS_SQL("x", !isI)} AS pay_status FROM ${T} x WHERE x.id=$1`, [id(x)]);
  if (!d) throw new HttpError(404, "Not found");
  const items = await q(c, `SELECT i.*, ac.name AS category FROM ${isI ? "invoice_items" : "bill_items"} i LEFT JOIN account_categories ac ON ac.id=i.category_id WHERE ${isI ? "invoice_id" : "bill_id"}=$1 ORDER BY i.id`, [d.id]);
  const payments = await q(c, `SELECT p.*, ba.name AS bank_name, un.name AS by FROM payments p JOIN bank_accounts ba ON ba.id=p.bank_account_id LEFT JOIN user_names un ON un.id=p.created_by WHERE ${isI ? "invoice_id" : "bill_id"}=$1 ORDER BY p.pay_date, p.id`, [d.id]);
  const party = await q1(c, `SELECT * FROM ${isI ? "customers" : "vendors"} WHERE id=$1`, [d[isI ? "customer_id" : "vendor_id"]]);
  return { ...d, items, payments, party };
});
GET("/invoices/:id", getDoc("invoice")); GET("/bills/:id", getDoc("bill"));
POST("/invoices", async (x) => x.run((c) => saveInvoice(c, x.u, x.body)));
PUT("/invoices/:id", async (x) => x.run((c) => saveInvoice(c, x.u, x.body, id(x))));
POST("/invoices/:id/issue", async (x) => x.run((c) => issueInvoice(c, x.u, id(x))));
POST("/invoices/:id/void", async (x) => x.run((c) => voidInvoice(c, x.u, id(x), String(x.body?.reason || ""))).then(() => ({ ok: true })));
DEL("/invoices/:id", async (x) => x.run((c) => deleteDraftInvoice(c, x.u, id(x))).then(() => ({ ok: true })));
POST("/invoices/:id/payments", async (x) => x.run((c) => recordPayment(c, x.u, "receipt", id(x), x.body)));
POST("/bills", async (x) => x.run((c) => saveBill(c, x.u, x.body)));
PUT("/bills/:id", async (x) => x.run((c) => saveBill(c, x.u, x.body, id(x))));
POST("/bills/:id/post", async (x) => x.run((c) => postBill(c, x.u, id(x))));
POST("/bills/:id/void", async (x) => x.run((c) => voidBill(c, x.u, id(x), String(x.body?.reason || ""))).then(() => ({ ok: true })));
DEL("/bills/:id", async (x) => x.run((c) => deleteDraftBill(c, x.u, id(x))).then(() => ({ ok: true })));
POST("/bills/:id/payments", async (x) => x.run((c) => recordPayment(c, x.u, "payment", id(x), x.body)));
POST("/payments/:id/void", async (x) => x.run((c) => voidPayment(c, x.u, id(x), String(x.body?.reason || ""))).then(() => ({ ok: true })));
GET("/invoices/:id/pdf", async (x) => x.run(async (c) => {
  const inv = await q1(c, "SELECT * FROM invoices WHERE id=$1", [id(x)]);
  if (!inv) throw new HttpError(404, "Not found");
  const [co, cu, items, pays] = await Promise.all([q1(c, "SELECT * FROM companies WHERE id=$1", [inv.company_id]), q1(c, "SELECT * FROM customers WHERE id=$1", [inv.customer_id]), q(c, "SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id", [inv.id]), q(c, "SELECT * FROM payments WHERE invoice_id=$1 ORDER BY pay_date", [inv.id])]);
  const buf = await invoicePdf(inv, co, cu, items, pays);
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${x.qs.download ? "attachment" : "inline"}; filename="${inv.invoice_no.replace(/[^\w.-]/g, "_")}.pdf"` } });
}));

// ===================== MASTER DATA =====================
const master = (name: string, table: string, cols: string[], opts: { perm?: "master.write" | "payroll.write"; read?: "payroll.read"; extraWhere?: string } = {}) => {
  GET(`/${name}`, async ({ u, qs, run }) => { if (opts.read) need(u, opts.read); return run(async (c) => {
    const ids = scopeIds(u, qs.company); const { size, off, page } = paging(qs);
    const rows = await q(c, `SELECT t.*, co.name AS company_name FROM ${table} t JOIN companies co ON co.id=t.company_id WHERE t.company_id=ANY($1) AND ($2::text IS NULL OR t.name ILIKE $2) ORDER BY t.name LIMIT ${size} OFFSET ${off}`, [ids, qs.q ? like(qs.q) : null]);
    const t = await q1(c, `SELECT count(*)::int n FROM ${table} t WHERE t.company_id=ANY($1) AND ($2::text IS NULL OR t.name ILIKE $2)`, [ids, qs.q ? like(qs.q) : null]);
    return { rows, total: t!.n, page, pageSize: size };
  }); });
  POST(`/${name}`, async ({ u, body, run }) => { need(u, opts.perm || "master.write"); const co = writeCompany(u, body.company_id); if (!String(body.name || "").trim()) throw new HttpError(400, "Name is required");
    return run(async (c) => { const vals = cols.map((k) => (body[k] === "" ? null : body[k] ?? null)); const row = await q1(c, `INSERT INTO ${table}(company_id,${cols.join(",")}) VALUES ($1,${cols.map((_, i) => "$" + (i + 2)).join(",")}) RETURNING *`, [co, ...vals]); await audit(c, u, { action: "create", entity: name, id: row.id, company: co, after: row }); return row; }); });
  PUT(`/${name}/:id`, async (x) => { need(x.u, opts.perm || "master.write"); return x.run(async (c) => { const old = await q1(c, `SELECT * FROM ${table} WHERE id=$1`, [id(x)]); if (!old) throw new HttpError(404, "Not found");
    const vals = cols.map((k) => (x.body[k] === "" ? null : x.body[k] ?? old[k])); const row = await q1(c, `UPDATE ${table} SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(",")} WHERE id=$1 RETURNING *`, [old.id, ...vals]); await audit(c, x.u, { action: "update", entity: name, id: old.id, company: old.company_id, before: old, after: row }); return row; }); });
  DEL(`/${name}/:id`, async (x) => { need(x.u, opts.perm || "master.write"); return x.run(async (c) => { const old = await q1(c, `SELECT * FROM ${table} WHERE id=$1`, [id(x)]); if (!old) throw new HttpError(404, "Not found");
    await c.query(`UPDATE ${table} SET active=false WHERE id=$1`, [old.id]); await audit(c, x.u, { action: "deactivate", entity: name, id: old.id, company: old.company_id, before: old }); return { ok: true }; }); });
};
master("customers", "customers", ["name", "email", "phone", "gstin", "address", "state_code", "credit_days"]);
master("vendors", "vendors", ["name", "email", "phone", "gstin", "pan", "address", "state_code", "credit_days"]);
master("employees", "employees", ["emp_code", "name", "email", "phone", "designation", "department", "join_date", "pan", "basic", "allowances", "deductions"], { perm: "payroll.write", read: "payroll.read" });
// party balances for the customers / vendors pages
GET("/customers/:id/statement", async (x) => x.run((c) => q(c, `SELECT invoice_no, issue_date, due_date, total, amount_paid, (total-amount_paid) AS balance, ${STATUS_SQL("i")} AS status FROM invoices i WHERE customer_id=$1 AND status<>'draft' ORDER BY issue_date DESC`, [id(x)])));
GET("/vendors/:id/statement", async (x) => x.run((c) => q(c, `SELECT bill_no AS invoice_no, bill_date AS issue_date, due_date, (total-tds_amount) AS total, amount_paid, (total-tds_amount-amount_paid) AS balance, ${STATUS_SQL("b", true)} AS status FROM bills b WHERE vendor_id=$1 AND status<>'draft' ORDER BY bill_date DESC`, [id(x)])));

// categories (configurable) & chart of accounts
GET("/categories", async ({ u, qs, run }) => run((c) => q(c, "SELECT ac.*, a.name AS account_name, a.code AS account_code, a.subtype FROM account_categories ac JOIN accounts a ON a.id=ac.account_id WHERE ac.company_id=ANY($1) AND ($2::text IS NULL OR ac.kind=$2) ORDER BY ac.company_id, ac.kind, ac.name", [scopeIds(u, qs.company), qs.kind || null])));
POST("/categories", async ({ u, body, run }) => { need(u, "master.write"); const co = writeCompany(u, body.company_id); if (!["income", "expense"].includes(body.kind) || !String(body.name || "").trim()) throw new HttpError(400, "Kind and name required");
  return run(async (c) => { const a = await q1(c, "SELECT id,type FROM accounts WHERE id=$1 AND company_id=$2", [body.account_id, co]); if (!a) throw new HttpError(400, "Choose a ledger account of this company");
    if (body.kind === "income" && a.type !== "income") throw new HttpError(400, "Income categories must map to an income account"); if (body.kind === "expense" && !["expense", "asset"].includes(a.type)) throw new HttpError(400, "Expense categories must map to an expense (or asset) account");
    const row = await q1(c, "INSERT INTO account_categories(company_id,kind,name,account_id) VALUES ($1,$2,$3,$4) RETURNING *", [co, body.kind, body.name.trim(), a.id]); await audit(c, u, { action: "create", entity: "category", id: row.id, company: co, after: row }); return row; }); });
PUT("/categories/:id", async (x) => { need(x.u, "master.write"); return x.run(async (c) => { const old = await q1(c, "SELECT * FROM account_categories WHERE id=$1", [id(x)]); if (!old) throw new HttpError(404, "Not found");
  const row = await q1(c, "UPDATE account_categories SET name=COALESCE($2,name), active=COALESCE($3,active) WHERE id=$1 RETURNING *", [old.id, x.body.name || null, x.body.active ?? null]); await audit(c, x.u, { action: "update", entity: "category", id: old.id, company: old.company_id, before: old, after: row }); return row; }); });
GET("/accounts", async ({ u, qs, run }) => run((c) => q(c, `SELECT a.*, COALESCE((SELECT SUM(debit-credit) FROM journal_entry_lines l WHERE l.account_id=a.id),0) AS balance FROM accounts a WHERE a.company_id=ANY($1) AND ($2::text IS NULL OR a.type::text=$2) ORDER BY a.company_id, a.code`, [scopeIds(u, qs.company), qs.type || null])));
POST("/accounts", async ({ u, body, run }) => { need(u, "company.manage"); const co = writeCompany(u, body.company_id);
  if (!/^\d{4}$/.test(String(body.code || "")) || !body.name || !["asset", "liability", "equity", "income", "expense"].includes(body.type)) throw new HttpError(400, "Code (4 digits), name and type required");
  return run(async (c) => { const row = await q1(c, "INSERT INTO accounts(company_id,code,name,type,subtype) VALUES ($1,$2,$3,$4,$5) RETURNING *", [co, body.code, body.name, body.type, body.subtype || (body.type === "expense" ? "operating_expense" : body.type === "income" ? "revenue" : "other_" + body.type)]); await audit(c, u, { action: "create", entity: "account", id: row.id, company: co, after: row }); return row; }); });

// ===================== BANKING =====================
GET("/bank-accounts", async ({ u, qs, run }) => run((c) => q(c, `SELECT ba.*, co.name AS company_name, COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_entry_lines l WHERE l.account_id=ba.account_id),0) AS balance,
    (SELECT max(statement_date) FROM bank_reconciliations r WHERE r.bank_account_id=ba.id) AS last_reconciled FROM bank_accounts ba JOIN companies co ON co.id=ba.company_id WHERE ba.company_id=ANY($1) ORDER BY ba.company_id, ba.id`, [scopeIds(u, qs.company)])));
POST("/bank-accounts", async (x) => x.run((c) => createBankAccount(c, x.u, x.body)));
PUT("/bank-accounts/:id", async (x) => { need(x.u, "bank.write"); return x.run(async (c) => { const old = await q1(c, "SELECT * FROM bank_accounts WHERE id=$1", [id(x)]); if (!old) throw new HttpError(404, "Not found");
  const ref = x.body.account_ref ? "XXXX" + String(x.body.account_ref).replace(/\D/g, "").slice(-4) : old.account_ref;
  const row = await q1(c, "UPDATE bank_accounts SET name=COALESCE($2,name), bank_name=COALESCE($3,bank_name), account_ref=$4, active=COALESCE($5,active) WHERE id=$1 RETURNING *", [old.id, x.body.name || null, x.body.bank_name || null, ref, x.body.active ?? null]);
  await audit(c, x.u, { action: "update", entity: "bank_account", id: old.id, company: old.company_id, before: old, after: row }); return row; }); });
POST("/bank-accounts/:id/opening", async (x) => x.run((c) => adjustOpening(c, x.u, id(x), Number(x.body.opening_balance), String(x.body.reason || ""))));
GET("/bank-accounts/:id/ledger", async (x) => x.run(async (c) => {
  const ba = await q1(c, "SELECT * FROM bank_accounts WHERE id=$1", [id(x)]); if (!ba) throw new HttpError(404, "Not found");
  const rows = await q(c, `SELECT l.id, e.entry_date, e.entry_no, e.memo, e.source_type, l.debit, l.credit, (rl.line_id IS NOT NULL) AS reconciled,
      SUM(l.debit-l.credit) OVER (ORDER BY e.entry_date, l.id) AS balance FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN reconciled_lines rl ON rl.line_id=l.id
    WHERE l.account_id=$1 ORDER BY e.entry_date DESC, l.id DESC LIMIT 300`, [ba.account_id]);
  return { account: ba, rows };
}));
GET("/bank-accounts/:id/reconcile", async (x) => x.run((c) => unreconciledLines(c, x.u, id(x), dateRe.test(x.qs.upTo || "") ? x.qs.upTo : today())));
POST("/reconcile", async (x) => x.run((c) => reconcile(c, x.u, x.body)));
GET("/reconciliations", async ({ u, qs, run }) => run((c) => q(c, "SELECT r.*, ba.name AS account, un.name AS by FROM bank_reconciliations r JOIN bank_accounts ba ON ba.id=r.bank_account_id LEFT JOIN user_names un ON un.id=r.reconciled_by WHERE r.company_id=ANY($1) ORDER BY r.created_at DESC LIMIT 50", [scopeIds(u, qs.company)])));

// ===================== BUDGETS =====================
GET("/budgets", async ({ u, qs, run }) => run((c) => q(c, "SELECT b.*, ac.name AS category, co.name AS company_name FROM budgets b JOIN account_categories ac ON ac.id=b.category_id JOIN companies co ON co.id=b.company_id WHERE b.company_id=ANY($1) AND ($2::text IS NULL OR b.fy=$2) ORDER BY b.company_id, ac.name, b.month NULLS FIRST", [scopeIds(u, qs.company), qs.fy || null])));
POST("/budgets", async ({ u, body, run }) => { need(u, "budget.write"); const co = writeCompany(u, body.company_id); if (!(Number(body.amount) >= 0) || !/^\d{4}-\d{2}$/.test(body.fy || "")) throw new HttpError(400, "Financial year (e.g. 2026-27) and amount required");
  return run(async (c) => { const row = await q1(c, "INSERT INTO budgets(company_id,fy,category_id,department,month,amount) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (company_id,fy,category_id,month) DO UPDATE SET amount=EXCLUDED.amount, department=EXCLUDED.department RETURNING *", [co, body.fy, body.category_id, body.department || null, body.month || null, body.amount]); await audit(c, u, { action: "upsert", entity: "budget", id: row.id, company: co, after: row }); return row; }); });
DEL("/budgets/:id", async (x) => { need(x.u, "budget.write"); return x.run(async (c) => { const old = await q1(c, "SELECT * FROM budgets WHERE id=$1", [id(x)]); if (!old) throw new HttpError(404, "Not found"); await c.query("DELETE FROM budgets WHERE id=$1", [old.id]); await audit(c, x.u, { action: "delete", entity: "budget", id: old.id, company: old.company_id, before: old }); return { ok: true }; }); });

// ===================== TAX =====================
GET("/tax-records", async ({ u, qs, run }) => run((c) => q(c, "SELECT t.*, co.name AS company_name, un.name AS verified_by_name FROM tax_records t JOIN companies co ON co.id=t.company_id LEFT JOIN user_names un ON un.id=t.verified_by WHERE t.company_id=ANY($1) ORDER BY t.record_date DESC, t.id DESC LIMIT 200", [scopeIds(u, qs.company)])));
POST("/tax-records", async (x) => x.run((c) => createTaxRecord(c, x.u, x.body)));
POST("/tax-records/:id/void", async (x) => x.run((c) => voidTaxRecord(c, x.u, id(x), String(x.body?.reason || ""))).then(() => ({ ok: true })));
POST("/tax-records/:id/verify", async (x) => x.run((c) => verifyTaxRecord(c, x.u, id(x))).then(() => ({ ok: true })));

// ===================== PAYROLL (restricted) =====================
GET("/payroll", async ({ u, qs, run }) => { need(u, "payroll.read"); return run((c) => q(c, "SELECT p.*, co.name AS company_name, (SELECT count(*)::int FROM payroll_items i WHERE i.payroll_id=p.id) AS employees FROM payroll p JOIN companies co ON co.id=p.company_id WHERE p.company_id=ANY($1) ORDER BY p.month DESC, p.company_id", [scopeIds(u, qs.company)])); });
POST("/payroll", async (x) => x.run((c) => createPayroll(c, x.u, Number(x.body.company_id), String(x.body.month))));
GET("/payroll/:id", async (x) => { need(x.u, "payroll.read"); return x.run(async (c) => { const p = await q1(c, "SELECT p.*, co.name AS company_name FROM payroll p JOIN companies co ON co.id=p.company_id WHERE p.id=$1", [id(x)]); if (!p) throw new HttpError(404, "Not found");
  return { ...p, items: await q(c, "SELECT i.*, e.name, e.emp_code, e.designation FROM payroll_items i JOIN employees e ON e.id=i.employee_id WHERE i.payroll_id=$1 ORDER BY e.emp_code", [p.id]) }; }); });
PUT("/payroll/items/:id", async (x) => x.run((c) => updatePayrollItem(c, x.u, id(x), x.body)).then(() => ({ ok: true })));
POST("/payroll/:id/post", async (x) => x.run((c) => postPayroll(c, x.u, id(x))).then(() => ({ ok: true })));
POST("/payroll/:id/pay", async (x) => x.run((c) => payPayroll(c, x.u, id(x), x.body)).then(() => ({ ok: true })));
GET("/payroll/items/:id/payslip", async (x) => { need(x.u, "payroll.read"); return x.run(async (c) => { const it = await q1(c, "SELECT i.*, p.month FROM payroll_items i JOIN payroll p ON p.id=i.payroll_id WHERE i.id=$1", [id(x)]); if (!it) throw new HttpError(404, "Not found");
  const [emp, co] = await Promise.all([q1(c, "SELECT * FROM employees WHERE id=$1", [it.employee_id]), q1(c, "SELECT * FROM companies WHERE id=$1", [it.company_id])]);
  await audit(c, x.u, { action: "payslip", entity: "payroll_item", id: it.id, company: it.company_id });
  return new Response(new Uint8Array(await payslipPdf(co, emp, it, it.month)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="payslip-${emp.emp_code}-${it.month}.pdf"` } }); }); });
GET("/advances", async ({ u, qs, run }) => { need(u, "payroll.read"); return run((c) => q(c, "SELECT a.*, e.name AS employee, co.name AS company_name, ba.name AS bank FROM employee_advances a JOIN employees e ON e.id=a.employee_id JOIN companies co ON co.id=a.company_id JOIN bank_accounts ba ON ba.id=a.bank_account_id WHERE a.company_id=ANY($1) ORDER BY a.advance_date DESC", [scopeIds(u, qs.company)])); });
POST("/advances", async (x) => x.run((c) => addAdvance(c, x.u, x.body)));

// ===================== COMPANIES, USERS, PERIODS, AUDIT, BACKUP =====================
POST("/companies", async ({ u, body }) => { need(u, "company.manage");
  const s = z.object({ code: z.string().regex(/^[A-Z]{2,5}$/), name: z.string().min(2), legal_name: z.string().optional(), gstin: z.string().optional(), state_code: z.string().optional() }).safeParse(body);
  if (!s.success) throw new HttpError(400, "Code (2–5 capital letters) and name are required");
  const d = s.data;
  return sys(async (c) => { const co = await q1(c, "INSERT INTO companies(code,name,legal_name,gstin,state_code,logo_text,invoice_prefix,bill_prefix) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [d.code, d.name, d.legal_name || d.name, d.gstin || null, d.state_code || null, d.name.slice(0, 2).toUpperCase(), `${d.code}/INV`, `${d.code}/BILL`]).catch((e) => { if (e.code === "23505") throw new HttpError(409, "Company code already exists"); throw e; });
    await onboardCompany(c, co); await c.query("INSERT INTO audit_logs(user_id,user_email,company_id,action,entity_type,entity_id,after) VALUES ($1,$2,$3,'create','company',$3::text,$4)", [u.id, u.email, co.id, JSON.stringify(co)]); return co; }); });
PUT("/companies/:id", async (x) => { need(x.u, "company.manage"); const cid = id(x); const b = x.body;
  const f = ["name", "legal_name", "business_type", "gstin", "pan", "address", "city", "state", "state_code", "pincode", "phone", "email", "logo_text", "brand_color", "payment_terms", "bank_details", "gst_registered", "active"];
  if (b.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(b.gstin)) throw new HttpError(400, "GSTIN format is invalid");
  return x.run(async (c) => { const old = await q1(c, "SELECT * FROM companies WHERE id=$1", [cid]); if (!old) throw new HttpError(404, "Not found");
    const vals = f.map((k) => (b[k] === "" ? null : b[k] ?? old[k]));
    const row = await q1(c, `UPDATE companies SET ${f.map((k, i) => `${k}=$${i + 2}`).join(",")}, features=COALESCE($${f.length + 2}, features) WHERE id=$1 RETURNING *`, [cid, ...vals, b.features ? JSON.stringify(b.features) : null]);
    await audit(c, x.u, { action: "update", entity: "company", id: cid, company: cid, before: old, after: row }); return row; }); });
GET("/users", async ({ u }) => { need(u, "users.manage"); return sys((c) => q(c, `SELECT p.id,p.email,p.name,p.role,p.active,p.last_login,p.created_at, COALESCE((SELECT json_agg(company_id) FROM company_memberships m WHERE m.user_id=p.id),'[]') AS company_ids FROM user_profiles p ORDER BY p.id`)); });
POST("/users", async ({ u, body }) => { need(u, "users.manage");
  const s = z.object({ email: z.string().email(), name: z.string().min(2), role: z.enum(["SUPER_ADMIN", "COMPANY_ADMIN", "ACCOUNTANT", "VIEWER"]), password: z.string(), company_ids: z.array(z.number()).default([]) }).safeParse(body);
  if (!s.success) throw new HttpError(400, "Name, valid email, role and password are required"); validatePassword(s.data.password);
  if (s.data.role !== "SUPER_ADMIN" && !s.data.company_ids.length) throw new HttpError(400, "Assign at least one company");
  const hash = await hashPassword(s.data.password);
  return sys(async (c) => { const row = await q1(c, "INSERT INTO user_profiles(email,name,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,email,name,role", [s.data.email.toLowerCase(), s.data.name, hash, s.data.role]).catch((e) => { if (e.code === "23505") throw new HttpError(409, "A user with this email already exists"); throw e; });
    if (s.data.role !== "SUPER_ADMIN") for (const co of s.data.company_ids) await c.query("INSERT INTO company_memberships VALUES ($1,$2)", [row.id, co]);
    await c.query("INSERT INTO audit_logs(user_id,user_email,action,entity_type,entity_id,after) VALUES ($1,$2,'create','user',$3,$4)", [u.id, u.email, String(row.id), JSON.stringify({ ...row, company_ids: s.data.company_ids })]); return row; }); });
PUT("/users/:id", async (x) => { need(x.u, "users.manage"); const uid = id(x), b = x.body;
  return sys(async (c) => { const old = await q1(c, "SELECT id,email,name,role,active FROM user_profiles WHERE id=$1", [uid]); if (!old) throw new HttpError(404, "Not found");
    const role = b.role ?? old.role, active = b.active ?? old.active;
    if (uid === x.u.id && (role !== "SUPER_ADMIN" || !active)) throw new HttpError(400, "You cannot demote or deactivate yourself");
    await c.query("UPDATE user_profiles SET name=COALESCE($2,name), role=$3, active=$4 WHERE id=$1", [uid, b.name || null, role, active]);
    if (Array.isArray(b.company_ids)) { await c.query("DELETE FROM company_memberships WHERE user_id=$1", [uid]); if (role !== "SUPER_ADMIN") for (const co of b.company_ids) await c.query("INSERT INTO company_memberships VALUES ($1,$2)", [uid, co]); }
    if (!active) await c.query("UPDATE sessions SET revoked=true WHERE user_id=$1", [uid]);
    await c.query("INSERT INTO audit_logs(user_id,user_email,action,entity_type,entity_id,before,after) VALUES ($1,$2,'update','user',$3,$4,$5)", [x.u.id, x.u.email, String(uid), JSON.stringify(old), JSON.stringify({ role, active, company_ids: b.company_ids })]); return { ok: true }; }); });
POST("/users/:id/password", async (x) => { need(x.u, "users.manage"); validatePassword(String(x.body?.password || "")); const h = await hashPassword(x.body.password);
  await sys(async (c) => { await c.query("UPDATE user_profiles SET password_hash=$2, failed_logins=0, locked_until=NULL WHERE id=$1", [id(x), h]); await c.query("UPDATE sessions SET revoked=true WHERE user_id=$1", [id(x)]); await c.query("INSERT INTO audit_logs(user_id,user_email,action,entity_type,entity_id) VALUES ($1,$2,'password_reset','user',$3)", [x.u.id, x.u.email, String(id(x))]); }); return { ok: true }; });
POST("/periods/:id/status", async (x) => { need(x.u, "settings"); const st = x.body?.status; if (!["open", "closed"].includes(st)) throw new HttpError(400, "Invalid status");
  return x.run(async (c) => { const old = await q1(c, "SELECT * FROM financial_periods WHERE id=$1", [id(x)]); if (!old) throw new HttpError(404, "Not found"); await c.query("UPDATE financial_periods SET status=$2 WHERE id=$1", [old.id, st]); await audit(c, x.u, { action: st === "closed" ? "close_period" : "reopen_period", entity: "financial_period", id: old.id, company: old.company_id, before: old, after: { status: st } }); return { ok: true }; }); });
GET("/audit", async ({ u, qs, run }) => { need(u, "audit.read"); return run(async (c) => { const { size, off, page } = paging(qs);
  const where = `($1::int IS NULL OR a.company_id=$1) AND ($2::text IS NULL OR a.entity_type=$2) AND ($3::text IS NULL OR a.action=$3) AND ($4::date IS NULL OR a.ts>=$4) AND ($5::date IS NULL OR a.ts<$5::date+1) AND ($6::text IS NULL OR a.user_email ILIKE $6 OR a.note ILIKE $6 OR a.entity_id=$7)`;
  const args = [qs.company && qs.company !== "all" ? +qs.company : null, qs.entity || null, qs.action || null, dateRe.test(qs.from || "") ? qs.from : null, dateRe.test(qs.to || "") ? qs.to : null, qs.q ? like(qs.q) : null, qs.q || null];
  const rows = await q(c, `SELECT a.*, co.name AS company_name FROM audit_logs a LEFT JOIN companies co ON co.id=a.company_id WHERE ${where} ORDER BY a.ts DESC, a.id DESC LIMIT ${size} OFFSET ${off}`, args);
  const t = await q1(c, `SELECT count(*)::int n FROM audit_logs a WHERE ${where}`, args); return { rows, total: t!.n, page, pageSize: size }; }); });

// attachments (receipts / proofs): validated by magic bytes, size-limited, stored outside the web root
const UPLOAD_DIR = () => path.resolve(process.env.UPLOAD_DIR || "./storage/uploads");
const MAGIC: [string, number[], string][] = [["application/pdf", [0x25, 0x50, 0x44, 0x46], ".pdf"], ["image/png", [0x89, 0x50, 0x4e, 0x47], ".png"], ["image/jpeg", [0xff, 0xd8, 0xff], ".jpg"]];
POST("/attachments", async ({ req, u, run }) => { need(u, "txn.write");
  const f = await req.formData(); const file = f.get("file") as File | null; const type = String(f.get("entity_type") || ""), eid = Number(f.get("entity_id"));
  if (!file || !["transaction", "invoice", "bill"].includes(type) || !eid) throw new HttpError(400, "file, entity_type and entity_id are required");
  if (file.size > 5 * 1024 * 1024) throw new HttpError(413, "File too large (max 5 MB)");
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = MAGIC.find(([, m]) => m.every((b, i) => buf[i] === b)) || (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP" ? ["image/webp", [], ".webp"] as [string, number[], string] : null);
  if (!kind) throw new HttpError(415, "Only PDF, PNG, JPEG or WebP files are accepted");
  const table = { transaction: "transactions", invoice: "invoices", bill: "bills" }[type]!;
  return run(async (c) => { const owner = await q1(c, `SELECT company_id FROM ${table} WHERE id=$1`, [eid]); if (!owner) throw new HttpError(404, "Record not found");
    const hash = crypto.createHash("sha256").update(buf).digest("hex"); const key = `${owner.company_id}/${crypto.randomUUID()}${kind[2]}`; const full = path.join(UPLOAD_DIR(), key);
    fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, buf);
    const row = await q1(c, "INSERT INTO attachments(company_id,entity_type,entity_id,filename,mime,size,storage_key,sha256,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,filename,mime,size", [owner.company_id, type, eid, path.basename(file.name).replace(/[^\w.\- ]/g, "_").slice(0, 120), kind[0], buf.length, key, hash, u.id]);
    await audit(c, u, { action: "upload", entity: "attachment", id: row.id, company: owner.company_id, note: `${type} ${eid}` }); return row; }); });
GET("/attachments/:id", async (x) => x.run(async (c) => { const a = await q1(c, "SELECT * FROM attachments WHERE id=$1", [id(x)]); if (!a) throw new HttpError(404, "Not found");
  const full = path.join(UPLOAD_DIR(), a.storage_key); if (!full.startsWith(UPLOAD_DIR())) throw new HttpError(400, "Bad path");
  return new Response(new Uint8Array(fs.readFileSync(full)), { headers: { "Content-Type": a.mime, "Content-Disposition": `inline; filename="${a.filename}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" } }); }));

// database backups (pg_dump custom format) — super admin only
const BACKUP_DIR = () => path.resolve(process.env.BACKUP_DIR || "./storage/backups");
GET("/admin/backups", async ({ u }) => { need(u, "settings"); const d = BACKUP_DIR(); if (!fs.existsSync(d)) return []; return fs.readdirSync(d).filter((f) => f.endsWith(".dump")).map((f) => ({ name: f, size: fs.statSync(path.join(d, f)).size, created: fs.statSync(path.join(d, f)).mtime })).sort((a, b) => +b.created - +a.created); });
POST("/admin/backups", async ({ u }) => { need(u, "settings"); const d = BACKUP_DIR(); fs.mkdirSync(d, { recursive: true });
  const file = path.join(d, `erp-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);
  await new Promise<void>((res, rej) => execFile("pg_dump", ["-Fc", "-f", file, process.env.DATABASE_URL || "postgresql://postgres@localhost:5434/erp"], (e, _o, se) => (e ? rej(new HttpError(500, "pg_dump failed: " + (se || e.message).slice(0, 200))) : res())));
  await sys((c) => c.query("INSERT INTO audit_logs(user_id,user_email,action,entity_type,note) VALUES ($1,$2,'backup','system',$3)", [u.id, u.email, path.basename(file)])); return { ok: true, file: path.basename(file), size: fs.statSync(file).size }; });

// ===================== dispatcher =====================
function mapError(e: any): { status: number; message: string; details?: unknown } {
  if (e instanceof HttpError) return { status: e.status, message: e.message, details: e.details };
  if (e?.code === "23505") return { status: 409, message: "A record with these details already exists" };
  if (e?.code === "23503") return { status: 409, message: "This record is referenced by other data and cannot be changed this way" };
  if (e?.code === "23514") return { status: 400, message: "A value is out of the allowed range" };
  if (e?.code === "22P02" || e?.code === "22007" || e?.code === "22008") return { status: 400, message: "A value has an invalid format" };
  if (e?.code === "P0001" || e?.code === "23P01") return { status: 409, message: String(e.message).replace(/^.*?: /, "") };
  if (e?.code === "42501") return { status: 403, message: "Not permitted for your role / company" };
  console.error("[api]", e);
  return { status: 500, message: "Something went wrong. Please try again." };
}

export async function dispatch(req: NextRequest, segs: string[]): Promise<Response> {
  const pathname = "/" + segs.join("/");
  try {
    const route = routes.find((r) => r.method === req.method && r.re.test(pathname));
    if (!route) throw new HttpError(404, "Not found");
    if (req.method !== "GET") {
      const origin = req.headers.get("origin"); const host = req.headers.get("host");
      if (origin && host && new URL(origin).host !== host) throw new HttpError(403, "Cross-site request blocked");
    }
    const m = route.re.exec(pathname)!; const p: Record<string, string> = {}; route.keys.forEach((k, i) => (p[k] = decodeURIComponent(m[i + 1])));
    let body: any = {};
    if (req.method !== "GET" && req.method !== "DELETE" && !(req.headers.get("content-type") || "").includes("multipart")) {
      const txt = await req.text(); if (txt.length > 1_000_000) throw new HttpError(413, "Request too large");
      try { body = txt ? JSON.parse(txt) : {}; } catch { throw new HttpError(400, "Invalid JSON"); }
    }
    const u = route.pub ? ((await currentUser()) as SessionUser) : await requireUser();
    const ctx: Ctx = { req, u, p, qs: Object.fromEntries(req.nextUrl.searchParams), body, run: (fn) => tx(u, fn) };
    const out = await route.h(ctx);
    if (out instanceof Response) return out;
    return Response.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const m = mapError(e);
    return Response.json({ error: m.message, details: m.details }, { status: m.status });
  }
}
void sha; void nextNo;
