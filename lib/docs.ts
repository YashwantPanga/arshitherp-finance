// Invoices (receivables), bills (payables) and the receipts/payments applied to them.
import { Client, HttpError, SessionUser, q, q1 } from "./db";
import { addDays, fromPaise, fyOf, need, nextNo, r2, toPaise, writeCompany } from "./core";
import { acctBySubtype, assertFunds, audit, bankLedger, categoryAccount, post, reverse, splitTax } from "./ledger";

export const STATUS_SQL = (a: string, bill = false) => `CASE WHEN ${a}.status='voided' THEN 'voided' WHEN ${a}.status='draft' THEN 'draft'
  WHEN ${a}.amount_paid >= ${a}.total - ${bill ? `${a}.tds_amount` : "0"} THEN 'paid'
  WHEN ${a}.due_date < CURRENT_DATE THEN 'overdue' WHEN ${a}.amount_paid > 0 THEN 'partially_paid' ELSE 'unpaid' END`;

interface ItemIn { description: string; hsn_sac?: string; category_id?: number; quantity: number; unit_price: number; discount?: number; gst_rate?: number }

function calcItems(items: ItemIn[], gstRegistered: boolean) {
  if (!items?.length) throw new HttpError(400, "Add at least one line item");
  let sub = 0, disc = 0, tax = 0, total = 0;
  const out = items.map((it) => {
    const qty = Number(it.quantity), price = Number(it.unit_price);
    if (!(qty > 0) || !(price >= 0)) throw new HttpError(400, "Quantity and unit price must be valid");
    const gross = toPaise(qty * price);
    const d = toPaise(it.discount || 0);
    if (d < 0 || d > gross) throw new HttpError(400, "Discount cannot exceed the line amount");
    const taxable = gross - d;
    const rate = gstRegistered ? Number(it.gst_rate || 0) : 0;
    const t = Math.round((taxable * rate) / 100);
    sub += gross; disc += d; tax += t; total += taxable + t;
    return { ...it, gross, d, taxable, t, rate, amount: taxable + t };
  });
  return { rows: out, sub, disc, tax, total };
}

// ===================== INVOICES =====================
export async function saveInvoice(c: Client, u: SessionUser, i: any, id?: number) {
  need(u, "invoice.write");
  const companyId = writeCompany(u, i.company_id);
  const co = await q1(c, "SELECT * FROM companies WHERE id=$1", [companyId]);
  const cust = await q1(c, "SELECT * FROM customers WHERE id=$1 AND company_id=$2", [i.customer_id, companyId]);
  if (!cust) throw new HttpError(400, "Select a customer of this company");
  const issue = i.issue_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue || "")) throw new HttpError(400, "Issue date required");
  const due = i.due_date || addDays(issue, cust.credit_days ?? 15);
  if (due < issue) throw new HttpError(400, "Due date cannot be before the issue date");
  const taxType = !co.gst_registered ? "NONE" : i.tax_type || (cust.state_code && co.state_code && cust.state_code !== co.state_code ? "IGST" : "GST");
  const calc = calcItems(i.items, co.gst_registered);
  const gst = splitTax(calc.tax, taxType);
  for (const it of calc.rows) {
    if (!it.category_id) throw new HttpError(400, "Pick an income category for every line");
    await categoryAccount(c, companyId, Number(it.category_id), "income");
  }
  let inv: any;
  if (id) {
    const old = await q1(c, "SELECT * FROM invoices WHERE id=$1", [id]);
    if (!old) throw new HttpError(404, "Invoice not found");
    if (old.status !== "draft") throw new HttpError(409, "Only draft invoices can be edited. Void and re-issue a posted invoice.");
    await c.query("DELETE FROM invoice_items WHERE invoice_id=$1", [id]);
    inv = await q1(c, `UPDATE invoices SET customer_id=$2,issue_date=$3,due_date=$4,place_of_supply=$5,tax_type=$6,subtotal=$7,discount_total=$8,cgst=$9,sgst=$10,igst=$11,total=$12,project=$13,notes=$14,terms=$15 WHERE id=$1 RETURNING *`,
      [id, cust.id, issue, due, i.place_of_supply || cust.state_code || null, taxType, fromPaise(calc.sub), fromPaise(calc.disc), fromPaise(gst.cgst), fromPaise(gst.sgst), fromPaise(gst.igst), fromPaise(calc.total), i.project || null, i.notes || null, i.terms || co.payment_terms]);
  } else {
    inv = await q1(c, `INSERT INTO invoices(company_id,invoice_no,customer_id,issue_date,due_date,place_of_supply,tax_type,subtotal,discount_total,cgst,sgst,igst,total,project,notes,terms,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [companyId, `DRAFT-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, cust.id, issue, due, i.place_of_supply || cust.state_code || null, taxType, fromPaise(calc.sub), fromPaise(calc.disc), fromPaise(gst.cgst), fromPaise(gst.sgst), fromPaise(gst.igst), fromPaise(calc.total), i.project || null, i.notes || null, i.terms || co.payment_terms, u.id]);
  }
  for (const it of calc.rows)
    await c.query("INSERT INTO invoice_items(invoice_id,company_id,description,hsn_sac,category_id,quantity,unit_price,discount,gst_rate,taxable,tax,amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [inv.id, companyId, it.description, it.hsn_sac || null, it.category_id, it.quantity, it.unit_price, fromPaise(it.d), it.rate, fromPaise(it.taxable), fromPaise(it.t), fromPaise(it.amount)]);
  await audit(c, u, { action: id ? "update" : "create", entity: "invoice", id: inv.id, company: companyId, after: inv });
  if (i.post) return issueInvoice(c, u, inv.id);
  return inv;
}

export async function issueInvoice(c: Client, u: SessionUser, id: number) {
  need(u, "invoice.write");
  const inv = await q1(c, "SELECT * FROM invoices WHERE id=$1 FOR UPDATE", [id]);
  if (!inv) throw new HttpError(404, "Invoice not found");
  if (inv.status !== "draft") throw new HttpError(409, "Invoice is already issued");
  const co = await q1(c, "SELECT * FROM companies WHERE id=$1", [inv.company_id]);
  const items = await q(c, "SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id", [id]);
  const fy = fyOf(inv.issue_date);
  const no = await nextNo(c, inv.company_id, "INV", fy); // separate sequence per company
  const invoiceNo = `${co.invoice_prefix}/${fy}/${String(no).padStart(4, "0")}`;
  const ar = await acctBySubtype(c, inv.company_id, "receivable");
  const lines: any[] = [{ account_id: ar, debit: inv.total }];
  if (inv.discount_total > 0) lines.push({ account_id: await acctBySubtype(c, inv.company_id, "discount"), debit: inv.discount_total });
  const byAcct = new Map<number, number>();
  for (const it of items) {
    const a = await categoryAccount(c, inv.company_id, it.category_id, "income");
    byAcct.set(a, (byAcct.get(a) || 0) + toPaise(it.quantity * it.unit_price));
  }
  for (const [a, v] of byAcct) lines.push({ account_id: a, credit: fromPaise(v) });
  for (const [k, v] of Object.entries({ cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst }))
    if (v > 0) lines.push({ account_id: await acctBySubtype(c, inv.company_id, `output_${k}`), credit: v });
  const je = await post(c, u, { companyId: inv.company_id, date: inv.issue_date, memo: `Invoice ${invoiceNo}`, source: "invoice", sourceId: id, lines });
  const row = await q1(c, "UPDATE invoices SET status='posted', invoice_no=$2, journal_entry_id=$3 WHERE id=$1 RETURNING *", [id, invoiceNo, je]);
  await audit(c, u, { action: "issue", entity: "invoice", id, company: inv.company_id, after: { invoice_no: invoiceNo, total: inv.total } });
  return row;
}

export async function voidInvoice(c: Client, u: SessionUser, id: number, reason: string) {
  need(u, "invoice.write");
  const inv = await q1(c, "SELECT * FROM invoices WHERE id=$1 FOR UPDATE", [id]);
  if (!inv) throw new HttpError(404, "Invoice not found");
  if (inv.status === "voided") throw new HttpError(409, "Already voided");
  if (!reason || reason.trim().length < 3) throw new HttpError(400, "A reason is required");
  const active = await q1(c, "SELECT count(*)::int n FROM payments WHERE invoice_id=$1 AND status='posted'", [id]);
  if (active!.n > 0) throw new HttpError(409, "Void the payments received against this invoice first");
  if (inv.status === "posted") await reverse(c, u, inv.journal_entry_id, `void invoice ${inv.invoice_no}: ${reason}`);
  await c.query("UPDATE invoices SET status='voided', voided_by=$2, voided_at=now(), void_reason=$3 WHERE id=$1", [id, u.id, reason]);
  await audit(c, u, { action: "void", entity: "invoice", id, company: inv.company_id, before: { status: inv.status }, after: { status: "voided" }, note: reason });
}

export async function deleteDraftInvoice(c: Client, u: SessionUser, id: number) {
  need(u, "invoice.write");
  const inv = await q1(c, "SELECT * FROM invoices WHERE id=$1", [id]);
  if (!inv) throw new HttpError(404, "Invoice not found");
  if (inv.status !== "draft") throw new HttpError(409, "Only drafts can be deleted; void issued invoices");
  await c.query("DELETE FROM invoice_items WHERE invoice_id=$1", [id]);
  await c.query("DELETE FROM invoices WHERE id=$1", [id]);
  await audit(c, u, { action: "delete_draft", entity: "invoice", id, company: inv.company_id, before: inv });
}

// ===================== BILLS =====================
export async function saveBill(c: Client, u: SessionUser, i: any, id?: number) {
  need(u, "invoice.write");
  const companyId = writeCompany(u, i.company_id);
  const co = await q1(c, "SELECT * FROM companies WHERE id=$1", [companyId]);
  const v = await q1(c, "SELECT * FROM vendors WHERE id=$1 AND company_id=$2", [i.vendor_id, companyId]);
  if (!v) throw new HttpError(400, "Select a vendor of this company");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.bill_date || "")) throw new HttpError(400, "Bill date required");
  const due = i.due_date || addDays(i.bill_date, v.credit_days ?? 15);
  if (due < i.bill_date) throw new HttpError(400, "Due date cannot be before the bill date");
  const taxType = !co.gst_registered ? "NONE" : i.tax_type || (v.state_code && co.state_code && v.state_code !== co.state_code ? "IGST" : "GST");
  const calc = calcItems((i.items || []).map((x: any) => ({ ...x, discount: 0 })), co.gst_registered);
  for (const it of calc.rows) {
    if (!it.category_id) throw new HttpError(400, "Pick an expense category for every line");
    await categoryAccount(c, companyId, Number(it.category_id), "expense");
  }
  const tds = toPaise(i.tds_amount || 0);
  if (tds < 0 || tds > calc.total) throw new HttpError(400, "Invalid TDS amount");
  const gst = splitTax(calc.tax, taxType);
  let bill: any;
  if (id) {
    const old = await q1(c, "SELECT * FROM bills WHERE id=$1", [id]);
    if (!old) throw new HttpError(404, "Bill not found");
    if (old.status !== "draft") throw new HttpError(409, "Only draft bills can be edited. Void and re-enter a posted bill.");
    await c.query("DELETE FROM bill_items WHERE bill_id=$1", [id]);
    bill = await q1(c, "UPDATE bills SET vendor_id=$2,vendor_bill_ref=$3,bill_date=$4,due_date=$5,tax_type=$6,subtotal=$7,cgst=$8,sgst=$9,igst=$10,tds_amount=$11,total=$12,notes=$13 WHERE id=$1 RETURNING *",
      [id, v.id, i.vendor_bill_ref || null, i.bill_date, due, taxType, fromPaise(calc.sub), fromPaise(gst.cgst), fromPaise(gst.sgst), fromPaise(gst.igst), fromPaise(tds), fromPaise(calc.total), i.notes || null]);
  } else {
    bill = await q1(c, `INSERT INTO bills(company_id,bill_no,vendor_id,vendor_bill_ref,bill_date,due_date,tax_type,subtotal,cgst,sgst,igst,tds_amount,total,notes,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [companyId, `DRAFT-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, v.id, i.vendor_bill_ref || null, i.bill_date, due, taxType, fromPaise(calc.sub), fromPaise(gst.cgst), fromPaise(gst.sgst), fromPaise(gst.igst), fromPaise(tds), fromPaise(calc.total), i.notes || null, u.id]);
  }
  for (const it of calc.rows)
    await c.query("INSERT INTO bill_items(bill_id,company_id,description,category_id,quantity,unit_price,gst_rate,taxable,tax,amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [bill.id, companyId, it.description, it.category_id, it.quantity, it.unit_price, it.rate, fromPaise(it.taxable), fromPaise(it.t), fromPaise(it.amount)]);
  await audit(c, u, { action: id ? "update" : "create", entity: "bill", id: bill.id, company: companyId, after: bill });
  if (i.post) return postBill(c, u, bill.id);
  return bill;
}

export async function postBill(c: Client, u: SessionUser, id: number) {
  need(u, "invoice.write");
  const b = await q1(c, "SELECT * FROM bills WHERE id=$1 FOR UPDATE", [id]);
  if (!b) throw new HttpError(404, "Bill not found");
  if (b.status !== "draft") throw new HttpError(409, "Bill is already posted");
  const co = await q1(c, "SELECT * FROM companies WHERE id=$1", [b.company_id]);
  const items = await q(c, "SELECT * FROM bill_items WHERE bill_id=$1", [id]);
  const fy = fyOf(b.bill_date);
  const no = await nextNo(c, b.company_id, "BILL", fy);
  const billNo = `${co.bill_prefix}/${fy}/${String(no).padStart(4, "0")}`;
  const lines: any[] = [];
  const byAcct = new Map<number, number>();
  for (const it of items) {
    const a = await categoryAccount(c, b.company_id, it.category_id, "expense");
    byAcct.set(a, (byAcct.get(a) || 0) + toPaise(it.taxable));
  }
  for (const [a, v] of byAcct) lines.push({ account_id: a, debit: fromPaise(v) });
  for (const [k, v] of Object.entries({ cgst: b.cgst, sgst: b.sgst, igst: b.igst }))
    if (v > 0) lines.push({ account_id: await acctBySubtype(c, b.company_id, `input_${k}`), debit: v });
  if (b.tds_amount > 0) lines.push({ account_id: await acctBySubtype(c, b.company_id, "tds_payable"), credit: b.tds_amount });
  lines.push({ account_id: await acctBySubtype(c, b.company_id, "payable"), credit: r2(b.total - b.tds_amount) });
  const je = await post(c, u, { companyId: b.company_id, date: b.bill_date, memo: `Bill ${billNo}`, source: "bill", sourceId: id, lines });
  const row = await q1(c, "UPDATE bills SET status='posted', bill_no=$2, journal_entry_id=$3 WHERE id=$1 RETURNING *", [id, billNo, je]);
  await audit(c, u, { action: "post", entity: "bill", id, company: b.company_id, after: { bill_no: billNo, total: b.total } });
  return row;
}

export async function voidBill(c: Client, u: SessionUser, id: number, reason: string) {
  need(u, "invoice.write");
  const b = await q1(c, "SELECT * FROM bills WHERE id=$1 FOR UPDATE", [id]);
  if (!b) throw new HttpError(404, "Bill not found");
  if (b.status === "voided") throw new HttpError(409, "Already voided");
  if (!reason || reason.trim().length < 3) throw new HttpError(400, "A reason is required");
  const active = await q1(c, "SELECT count(*)::int n FROM payments WHERE bill_id=$1 AND status='posted'", [id]);
  if (active!.n > 0) throw new HttpError(409, "Void the payments made against this bill first");
  if (b.status === "posted") await reverse(c, u, b.journal_entry_id, `void bill ${b.bill_no}: ${reason}`);
  await c.query("UPDATE bills SET status='voided', voided_by=$2, voided_at=now(), void_reason=$3 WHERE id=$1", [id, u.id, reason]);
  await audit(c, u, { action: "void", entity: "bill", id, company: b.company_id, before: { status: b.status }, after: { status: "voided" }, note: reason });
}

export async function deleteDraftBill(c: Client, u: SessionUser, id: number) {
  need(u, "invoice.write");
  const b = await q1(c, "SELECT * FROM bills WHERE id=$1", [id]);
  if (!b) throw new HttpError(404, "Bill not found");
  if (b.status !== "draft") throw new HttpError(409, "Only drafts can be deleted; void posted bills");
  await c.query("DELETE FROM bill_items WHERE bill_id=$1", [id]);
  await c.query("DELETE FROM bills WHERE id=$1", [id]);
  await audit(c, u, { action: "delete_draft", entity: "bill", id, company: b.company_id, before: b });
}

// ===================== RECEIPTS & PAYMENTS (partial payments supported) =====================
export async function recordPayment(c: Client, u: SessionUser, direction: "receipt" | "payment", docId: number, p: any) {
  need(u, "txn.write");
  const table = direction === "receipt" ? "invoices" : "bills";
  const doc = await q1(c, `SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [docId]); // row lock prevents concurrent over-payment
  if (!doc) throw new HttpError(404, "Document not found");
  if (doc.status !== "posted") throw new HttpError(409, "Only issued/posted documents can receive payments");
  const amount = toPaise(p.amount);
  if (amount <= 0) throw new HttpError(400, "Amount must be greater than zero");
  const payable = toPaise(doc.total) - toPaise(doc.tds_amount || 0);
  const outstanding = payable - toPaise(doc.amount_paid);
  if (amount > outstanding) throw new HttpError(400, `Amount exceeds the outstanding balance of ${fromPaise(outstanding)}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.pay_date || "")) throw new HttpError(400, "Payment date required");
  const bank = await bankLedger(c, doc.company_id, Number(p.bank_account_id));
  if (direction === "payment") await assertFunds(c, Number(p.bank_account_id), fromPaise(amount));
  const ctrl = await acctBySubtype(c, doc.company_id, direction === "receipt" ? "receivable" : "payable");
  const no = direction === "receipt" ? doc.invoice_no : doc.bill_no;
  const lines = direction === "receipt"
    ? [{ account_id: bank, debit: fromPaise(amount) }, { account_id: ctrl, credit: fromPaise(amount) }]
    : [{ account_id: ctrl, debit: fromPaise(amount) }, { account_id: bank, credit: fromPaise(amount) }];
  const pay = await q1(c, `INSERT INTO payments(company_id,direction,invoice_id,bill_id,bank_account_id,pay_date,amount,method,reference,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [doc.company_id, direction, direction === "receipt" ? docId : null, direction === "payment" ? docId : null, p.bank_account_id, p.pay_date, fromPaise(amount), p.method || null, p.reference || null, p.notes || null, u.id]);
  const je = await post(c, u, { companyId: doc.company_id, date: p.pay_date, memo: `${direction === "receipt" ? "Receipt" : "Payment"} against ${no}`, source: direction === "receipt" ? "payment" : "bill_payment", sourceId: pay.id, lines });
  await c.query("UPDATE payments SET journal_entry_id=$2 WHERE id=$1", [pay.id, je]);
  await c.query(`UPDATE ${table} SET amount_paid = amount_paid + $2 WHERE id=$1`, [docId, fromPaise(amount)]);
  await audit(c, u, { action: direction, entity: table === "invoices" ? "invoice" : "bill", id: docId, company: doc.company_id, after: { payment_id: pay.id, amount: fromPaise(amount) } });
  return pay;
}

export async function voidPayment(c: Client, u: SessionUser, id: number, reason: string) {
  need(u, "txn.write");
  const p = await q1(c, "SELECT * FROM payments WHERE id=$1 FOR UPDATE", [id]);
  if (!p) throw new HttpError(404, "Payment not found");
  if (p.status === "voided") throw new HttpError(409, "Already voided");
  if (!reason || reason.trim().length < 3) throw new HttpError(400, "A reason is required");
  await reverse(c, u, p.journal_entry_id, `void payment ${id}: ${reason}`);
  await c.query("UPDATE payments SET status='voided', voided_by=$2, voided_at=now() WHERE id=$1", [id, u.id]);
  const table = p.direction === "receipt" ? "invoices" : "bills";
  await c.query(`UPDATE ${table} SET amount_paid = amount_paid - $2 WHERE id=$1`, [p.invoice_id || p.bill_id, p.amount]);
  await audit(c, u, { action: "void", entity: "payment", id, company: p.company_id, before: p, note: reason });
}
