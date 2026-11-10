// Bank accounts & reconciliation, payroll, employee advances, tax payments.
import { Client, HttpError, SessionUser, q, q1 } from "./db";
import { fromPaise, monthEnd, need, r2, toPaise, today, writeCompany } from "./core";
import { acctBySubtype, assertFunds, audit, bankLedger, post, reverse } from "./ledger";

// ===================== BANK / CASH ACCOUNTS =====================
export async function createBankAccount(c: Client, u: SessionUser, i: any) {
  need(u, "bank.write");
  const companyId = writeCompany(u, i.company_id);
  if (!i.name?.trim()) throw new HttpError(400, "Account name required");
  const type = i.account_type || "bank";
  if (!["cash", "bank", "upi", "wallet"].includes(type)) throw new HttpError(400, "Invalid account type");
  const opening = r2(Number(i.opening_balance || 0));
  const next = await q1(c, "SELECT COALESCE(MAX(code::int),1000)+1 AS n FROM accounts WHERE company_id=$1 AND code ~ '^10[0-9]{2}$'", [companyId]);
  if (next!.n > 1099) throw new HttpError(400, "Too many bank/cash accounts");
  const acct = await q1(c, "INSERT INTO accounts(company_id,code,name,type,subtype,is_system) VALUES ($1,$2,$3,'asset',$4,false) RETURNING id", [companyId, String(next!.n), i.name.trim(), type === "cash" ? "cash" : "bank"]);
  // never keep full account numbers: store the last 4 digits only
  const ref = i.account_ref ? "XXXX" + String(i.account_ref).replace(/\D/g, "").slice(-4) : null;
  const ba = await q1(c, "INSERT INTO bank_accounts(company_id,account_id,name,bank_name,account_type,account_ref,opening_balance,opening_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
    [companyId, acct!.id, i.name.trim(), i.bank_name || null, type, ref, opening, i.opening_date || today()]);
  if (opening !== 0) await postOpening(c, u, ba, opening, "Opening balance");
  await audit(c, u, { action: "create", entity: "bank_account", id: ba.id, company: companyId, after: ba });
  return ba;
}

async function postOpening(c: Client, u: SessionUser, ba: any, delta: number, memo: string) {
  const eq = await acctBySubtype(c, ba.company_id, "opening_equity");
  await post(c, u, {
    companyId: ba.company_id, date: ba.opening_date, memo: `${memo}: ${ba.name}`, source: "opening", sourceId: ba.id,
    lines: delta > 0 ? [{ account_id: ba.account_id, debit: delta }, { account_id: eq, credit: delta }] : [{ account_id: eq, debit: -delta }, { account_id: ba.account_id, credit: -delta }],
  });
}

/** Opening balance changes post an adjusting entry (never edit history) and are audit-logged with a mandatory reason. */
export async function adjustOpening(c: Client, u: SessionUser, id: number, newOpening: number, reason: string) {
  need(u, "bank.write");
  if (!reason || reason.trim().length < 3) throw new HttpError(400, "A reason is required for opening balance adjustments");
  const ba = await q1(c, "SELECT * FROM bank_accounts WHERE id=$1 FOR UPDATE", [id]);
  if (!ba) throw new HttpError(404, "Account not found");
  const delta = r2(Number(newOpening) - ba.opening_balance);
  if (delta === 0) return ba;
  await postOpening(c, u, ba, delta, `Opening balance adjustment (${reason})`);
  const row = await q1(c, "UPDATE bank_accounts SET opening_balance=$2 WHERE id=$1 RETURNING *", [id, r2(Number(newOpening))]);
  await audit(c, u, { action: "opening_adjustment", entity: "bank_account", id, company: ba.company_id, before: { opening_balance: ba.opening_balance }, after: { opening_balance: row.opening_balance }, note: reason });
  return row;
}

// ===================== RECONCILIATION =====================
export async function unreconciledLines(c: Client, u: SessionUser, bankAccountId: number, upTo: string) {
  const ba = await q1(c, "SELECT * FROM bank_accounts WHERE id=$1", [bankAccountId]);
  if (!ba) throw new HttpError(404, "Account not found");
  const lines = await q(c,
    `SELECT l.id, e.entry_date, e.entry_no, e.memo, l.debit, l.credit
     FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id
     WHERE l.account_id=$1 AND e.entry_date<=$2 AND NOT EXISTS (SELECT 1 FROM reconciled_lines r WHERE r.line_id=l.id)
     ORDER BY e.entry_date, l.id`, [ba.account_id, upTo]);
  const rec = await q1(c, `SELECT COALESCE(SUM(l.debit-l.credit),0) AS bal FROM reconciled_lines r JOIN journal_entry_lines l ON l.id=r.line_id WHERE l.account_id=$1`, [ba.account_id]);
  return { account: ba, lines, reconciled_balance: rec!.bal };
}

export async function reconcile(c: Client, u: SessionUser, i: { bank_account_id: number; statement_date: string; statement_balance: number; line_ids: number[] }) {
  need(u, "reconcile");
  const ba = await q1(c, "SELECT * FROM bank_accounts WHERE id=$1", [i.bank_account_id]);
  if (!ba) throw new HttpError(404, "Account not found");
  if (!i.line_ids?.length) throw new HttpError(400, "Select the statement lines that have cleared");
  const ok = await q(c, `SELECT l.id, l.debit-l.credit AS amt FROM journal_entry_lines l WHERE l.id=ANY($1) AND l.account_id=$2 AND NOT EXISTS (SELECT 1 FROM reconciled_lines r WHERE r.line_id=l.id)`, [i.line_ids, ba.account_id]);
  if (ok.length !== i.line_ids.length) throw new HttpError(400, "Some lines are invalid or already reconciled");
  const prev = await q1(c, `SELECT COALESCE(SUM(l.debit-l.credit),0) AS bal FROM reconciled_lines r JOIN journal_entry_lines l ON l.id=r.line_id WHERE l.account_id=$1`, [ba.account_id]);
  const cleared = r2(prev!.bal + ok.reduce((s: number, x: any) => s + x.amt, 0));
  const book = await q1(c, "SELECT COALESCE(SUM(debit-credit),0) AS b FROM journal_entry_lines WHERE account_id=$1", [ba.account_id]);
  const rec = await q1(c, "INSERT INTO bank_reconciliations(company_id,bank_account_id,statement_date,statement_balance,book_balance,difference,reconciled_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [ba.company_id, ba.id, i.statement_date, r2(i.statement_balance), book!.b, r2(i.statement_balance - cleared), u.id]);
  for (const l of ok) await c.query("INSERT INTO reconciled_lines(line_id,reconciliation_id,company_id) VALUES ($1,$2,$3)", [l.id, rec.id, ba.company_id]);
  await audit(c, u, { action: "reconcile", entity: "bank_account", id: ba.id, company: ba.company_id, after: rec });
  return rec;
}

// ===================== PAYROLL =====================
export async function createPayroll(c: Client, u: SessionUser, companyIdIn: number, month: string) {
  need(u, "payroll.write");
  const companyId = writeCompany(u, companyIdIn);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "Month must be YYYY-MM");
  const emps = await q(c, "SELECT * FROM employees WHERE company_id=$1 AND active ORDER BY emp_code", [companyId]);
  if (!emps.length) throw new HttpError(400, "No active employees");
  const p = await q1(c, "INSERT INTO payroll(company_id,month,created_by) VALUES ($1,$2,$3) RETURNING *", [companyId, month, u.id]).catch((e) => {
    if (e.code === "23505") throw new HttpError(409, `Payroll for ${month} already exists`);
    throw e;
  });
  for (const e of emps) {
    const recovery = 0; // advance recoveries are entered manually per employee on the draft payroll
    const net = r2(e.basic + e.allowances - e.deductions - recovery);
    await c.query("INSERT INTO payroll_items(payroll_id,company_id,employee_id,basic,allowances,deductions,advance_recovery,net) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [p.id, companyId, e.id, e.basic, e.allowances, e.deductions, recovery, net]);
  }
  await recalcPayroll(c, p.id);
  await audit(c, u, { action: "create", entity: "payroll", id: p.id, company: companyId, after: p });
  return p;
}
async function recalcPayroll(c: Client, id: number) {
  await c.query(`UPDATE payroll SET total_gross=s.g, total_deductions=s.d, total_net=s.n FROM (SELECT SUM(basic+allowances) g, SUM(deductions+advance_recovery) d, SUM(net) n FROM payroll_items WHERE payroll_id=$1) s WHERE id=$1`, [id]);
}
export async function updatePayrollItem(c: Client, u: SessionUser, itemId: number, i: any) {
  need(u, "payroll.write");
  const it = await q1(c, "SELECT pi.*, p.status FROM payroll_items pi JOIN payroll p ON p.id=pi.payroll_id WHERE pi.id=$1", [itemId]);
  if (!it) throw new HttpError(404, "Not found");
  if (it.status !== "draft") throw new HttpError(409, "Only draft payroll can be edited");
  const b = r2(Number(i.basic ?? it.basic)), a = r2(Number(i.allowances ?? it.allowances)), d = r2(Number(i.deductions ?? it.deductions)), r = r2(Number(i.advance_recovery ?? it.advance_recovery));
  if ([b, a, d, r].some((x) => x < 0)) throw new HttpError(400, "Values cannot be negative");
  const net = r2(b + a - d - r);
  if (net < 0) throw new HttpError(400, "Net salary cannot be negative");
  await c.query("UPDATE payroll_items SET basic=$2,allowances=$3,deductions=$4,advance_recovery=$5,net=$6 WHERE id=$1", [itemId, b, a, d, r, net]);
  await recalcPayroll(c, it.payroll_id);
  await audit(c, u, { action: "update", entity: "payroll_item", id: itemId, company: it.company_id, before: it, after: { basic: b, allowances: a, deductions: d, advance_recovery: r, net } });
}
export async function postPayroll(c: Client, u: SessionUser, id: number) {
  need(u, "payroll.write");
  const p = await q1(c, "SELECT * FROM payroll WHERE id=$1 FOR UPDATE", [id]);
  if (!p) throw new HttpError(404, "Payroll not found");
  if (p.status !== "draft") throw new HttpError(409, "Payroll is already posted");
  const t = await q1(c, "SELECT SUM(basic+allowances) g, SUM(deductions) d, SUM(advance_recovery) r, SUM(net) n FROM payroll_items WHERE payroll_id=$1", [id]);
  const sal = await q1(c, "SELECT id FROM accounts WHERE company_id=$1 AND code='6010'", [p.company_id]);
  const lines: any[] = [{ account_id: sal!.id, debit: t!.g }, { account_id: await acctBySubtype(c, p.company_id, "salary_payable"), credit: t!.n }];
  if (t!.d > 0) lines.push({ account_id: await acctBySubtype(c, p.company_id, "tds_payable"), credit: t!.d });
  if (t!.r > 0) lines.push({ account_id: await acctBySubtype(c, p.company_id, "employee_advance"), credit: t!.r });
  const je = await post(c, u, { companyId: p.company_id, date: monthEnd(p.month), memo: `Payroll ${p.month}`, source: "payroll", sourceId: id, lines });
  await c.query("UPDATE payroll SET status='posted', journal_entry_id=$2 WHERE id=$1", [id, je]);
  await audit(c, u, { action: "post", entity: "payroll", id, company: p.company_id, after: { month: p.month, net: t!.n } });
}
export async function payPayroll(c: Client, u: SessionUser, id: number, i: { bank_account_id: number; pay_date: string; item_ids?: number[] }) {
  need(u, "payroll.write");
  const p = await q1(c, "SELECT * FROM payroll WHERE id=$1 FOR UPDATE", [id]);
  if (!p) throw new HttpError(404, "Payroll not found");
  if (p.status === "draft" || p.status === "voided") throw new HttpError(409, "Post the payroll before paying salaries");
  const items = await q(c, "SELECT * FROM payroll_items WHERE payroll_id=$1 AND paid_amount<net AND ($2::int[] IS NULL OR id=ANY($2))", [id, i.item_ids?.length ? i.item_ids : null]);
  const amount = items.reduce((s: number, x: any) => s + toPaise(x.net - x.paid_amount), 0);
  if (!amount) throw new HttpError(409, "Nothing left to pay");
  const bank = await bankLedger(c, p.company_id, Number(i.bank_account_id));
  await assertFunds(c, Number(i.bank_account_id), fromPaise(amount));
  await post(c, u, { companyId: p.company_id, date: i.pay_date, memo: `Salary payment ${p.month}`, source: "payroll", sourceId: id, lines: [{ account_id: await acctBySubtype(c, p.company_id, "salary_payable"), debit: fromPaise(amount) }, { account_id: bank, credit: fromPaise(amount) }] });
  await c.query("UPDATE payroll_items SET paid_amount=net, paid_date=$2 WHERE id=ANY($1)", [items.map((x: any) => x.id), i.pay_date]);
  const left = await q1(c, "SELECT count(*)::int n FROM payroll_items WHERE payroll_id=$1 AND paid_amount<net", [id]);
  if (left!.n === 0) await c.query("UPDATE payroll SET status='paid' WHERE id=$1", [id]);
  await audit(c, u, { action: "pay", entity: "payroll", id, company: p.company_id, after: { amount: fromPaise(amount), employees: items.length } });
}
export async function addAdvance(c: Client, u: SessionUser, i: any) {
  need(u, "payroll.write");
  const companyId = writeCompany(u, i.company_id);
  const amount = r2(Number(i.amount));
  if (!(amount > 0)) throw new HttpError(400, "Amount must be greater than zero");
  const emp = await q1(c, "SELECT id FROM employees WHERE id=$1 AND company_id=$2", [i.employee_id, companyId]);
  if (!emp) throw new HttpError(400, "Employee not found");
  const bank = await bankLedger(c, companyId, Number(i.bank_account_id));
  const adv = await q1(c, "INSERT INTO employee_advances(company_id,employee_id,advance_date,amount,bank_account_id,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [companyId, emp.id, i.advance_date || today(), amount, i.bank_account_id, i.notes || null, u.id]);
  const je = await post(c, u, { companyId, date: adv.advance_date, memo: "Employee advance", source: "payroll", sourceId: adv.id, lines: [{ account_id: await acctBySubtype(c, companyId, "employee_advance"), debit: amount }, { account_id: bank, credit: amount }] });
  await c.query("UPDATE employee_advances SET journal_entry_id=$2 WHERE id=$1", [adv.id, je]);
  await audit(c, u, { action: "create", entity: "employee_advance", id: adv.id, company: companyId, after: adv });
  return adv;
}

// ===================== TAX RECORDS =====================
export async function createTaxRecord(c: Client, u: SessionUser, i: any) {
  need(u, "tax.write");
  const companyId = writeCompany(u, i.company_id);
  const kind = i.kind;
  const cg = r2(Number(i.cgst || 0)), sg = r2(Number(i.sgst || 0)), ig = r2(Number(i.igst || 0));
  let amount = r2(Number(i.amount || 0));
  if (["gst_payment", "itc_setoff"].includes(kind)) amount = r2(cg + sg + ig);
  if (!(amount > 0) && kind !== "tds_certificate") throw new HttpError(400, "Amount must be greater than zero");
  if (!i.record_date) throw new HttpError(400, "Date required");
  const row = await q1(c, "INSERT INTO tax_records(company_id,kind,record_date,period,cgst,sgst,igst,amount,bank_account_id,reference,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
    [companyId, kind, i.record_date, i.period || null, cg, sg, ig, amount, i.bank_account_id || null, i.reference || null, i.notes || null, u.id]);
  let lines: any[] | null = null;
  if (kind === "gst_payment") {
    if (!i.bank_account_id) throw new HttpError(400, "Select the bank account used for the payment");
    const bank = await bankLedger(c, companyId, Number(i.bank_account_id));
    lines = [];
    for (const [k, v] of Object.entries({ cgst: cg, sgst: sg, igst: ig })) if (v > 0) lines.push({ account_id: await acctBySubtype(c, companyId, `output_${k}`), debit: v });
    lines.push({ account_id: bank, credit: amount });
  } else if (kind === "itc_setoff") {
    lines = [];
    for (const [k, v] of Object.entries({ cgst: cg, sgst: sg, igst: ig })) if (v > 0) {
      lines.push({ account_id: await acctBySubtype(c, companyId, `output_${k}`), debit: v }, { account_id: await acctBySubtype(c, companyId, `input_${k}`), credit: v });
    }
  } else if (kind === "tds_payment") {
    if (!i.bank_account_id) throw new HttpError(400, "Select the bank account used for the payment");
    lines = [{ account_id: await acctBySubtype(c, companyId, "tds_payable"), debit: amount }, { account_id: await bankLedger(c, companyId, Number(i.bank_account_id)), credit: amount }];
  }
  if (lines) {
    const je = await post(c, u, { companyId, date: i.record_date, memo: `${kind.replace("_", " ")} ${i.period || ""} ${i.reference || ""}`.trim(), source: "tax", sourceId: row.id, lines });
    await c.query("UPDATE tax_records SET journal_entry_id=$2 WHERE id=$1", [row.id, je]);
  }
  await audit(c, u, { action: "create", entity: "tax_record", id: row.id, company: companyId, after: row });
  return row;
}
export async function voidTaxRecord(c: Client, u: SessionUser, id: number, reason: string) {
  need(u, "tax.write");
  const t = await q1(c, "SELECT * FROM tax_records WHERE id=$1", [id]);
  if (!t) throw new HttpError(404, "Not found");
  if (t.status === "voided") throw new HttpError(409, "Already voided");
  if (!reason || reason.trim().length < 3) throw new HttpError(400, "A reason is required");
  if (t.journal_entry_id) await reverse(c, u, t.journal_entry_id, `void tax record ${id}: ${reason}`);
  await c.query("UPDATE tax_records SET status='voided' WHERE id=$1", [id]);
  await audit(c, u, { action: "void", entity: "tax_record", id, company: t.company_id, before: t, note: reason });
}
export async function verifyTaxRecord(c: Client, u: SessionUser, id: number) {
  need(u, "tax.write");
  await c.query("UPDATE tax_records SET verified_by=$2, verified_at=now() WHERE id=$1", [id, u.id]);
  await audit(c, u, { action: "verify", entity: "tax_record", id, note: "Accountant verified" });
}
