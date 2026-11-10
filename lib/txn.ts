// Income / expense / refund / capital / loan / transfer transactions -> journal entries
import { Client, HttpError, SessionUser, q, q1 } from "./db";
import { addMonths, fyOf, need, nextNo, r2, toPaise, fromPaise, today, writeCompany, can } from "./core";
import { acctBySubtype, assertFunds, audit, bankLedger, categoryAccount, post, reverse, splitTax } from "./ledger";

export const KIND_CODE: Record<string, string> = { income: "INC", expense: "EXP", refund: "REF", transfer: "TRF", capital: "CAP", drawing: "DRW", loan_in: "LNI", loan_repay: "LNR" };
const BANK_KINDS = ["transfer", "capital", "drawing", "loan_in", "loan_repay"];

export interface TxnInput {
  company_id: number; kind: string; txn_date: string;
  base_amount: number; tax_amount?: number; tds_amount?: number; tax_type?: string;
  category_id?: number | null; bank_account_id: number; to_bank_account_id?: number | null;
  customer_id?: number | null; vendor_id?: number | null; party_name?: string; invoice_no?: string;
  payment_method?: string; reference?: string; description?: string;
  recurring?: string | null; project?: string; payment_status?: string; as_draft?: boolean;
}

function validate(i: TxnInput, gstRegistered: boolean) {
  if (!KIND_CODE[i.kind]) throw new HttpError(400, "Invalid transaction type");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.txn_date || "")) throw new HttpError(400, "Valid date required");
  if (!(Number(i.base_amount) > 0)) throw new HttpError(400, "Amount must be greater than zero");
  if (Number(i.tax_amount || 0) < 0 || Number(i.tds_amount || 0) < 0) throw new HttpError(400, "Tax/TDS cannot be negative");
  if (!gstRegistered && Number(i.tax_amount || 0) > 0) throw new HttpError(400, "This company is not GST registered; tax must be zero");
  if (i.kind === "transfer" && (!i.to_bank_account_id || i.to_bank_account_id === i.bank_account_id)) throw new HttpError(400, "Choose two different accounts for a transfer");
  if ((i.kind === "income" || i.kind === "expense") && !i.category_id) throw new HttpError(400, "Category is required");
  if (Number(i.tds_amount || 0) > Number(i.base_amount) + Number(i.tax_amount || 0)) throw new HttpError(400, "TDS exceeds the amount");
}

async function company(c: Client, id: number) {
  const co = await q1(c, "SELECT * FROM companies WHERE id=$1", [id]);
  if (!co) throw new HttpError(404, "Company not found");
  return co;
}

/** Build and post the journal for a transaction row. Returns the journal entry id. */
async function postRow(c: Client, u: SessionUser, t: any): Promise<number> {
  const co = await company(c, t.company_id);
  if (["expense", "refund", "transfer", "drawing", "loan_repay"].includes(t.kind)) await assertFunds(c, t.bank_account_id, t.kind === "expense" ? t.amount - t.tds_amount : t.amount);
  const total = toPaise(t.amount), tax = toPaise(t.tax_amount), tds = toPaise(t.tds_amount), base = total - tax;
  const bank = await bankLedger(c, t.company_id, t.bank_account_id);
  const gst = co.gst_registered ? splitTax(tax, t.tax_type) : { cgst: 0, sgst: 0, igst: 0 };
  const memo = `${t.txn_no} ${t.party_name || ""} ${t.description || ""}`.trim();
  const L = (account_id: number, debit: number, credit: number) => ({ account_id, debit: fromPaise(debit), credit: fromPaise(credit) });
  const lines: any[] = [];
  const taxLegs = async (side: "in" | "out", dr: boolean) => {
    for (const [k, v] of Object.entries(gst)) {
      if (!v) continue;
      const a = await acctBySubtype(c, t.company_id, `${side === "in" ? "input" : "output"}_${k}`);
      lines.push(dr ? L(a, v, 0) : L(a, 0, v));
    }
  };
  switch (t.kind) {
    case "income": {
      const rev = await categoryAccount(c, t.company_id, t.category_id, "income");
      lines.push(L(bank, total, 0), L(rev, 0, base));
      await taxLegs("out", false);
      break;
    }
    case "expense": {
      const exp = await categoryAccount(c, t.company_id, t.category_id, "expense");
      lines.push(L(exp, base, 0));
      await taxLegs("in", true);
      if (tds) lines.push(L(await acctBySubtype(c, t.company_id, "tds_payable"), 0, tds));
      lines.push(L(bank, 0, total - tds));
      break;
    }
    case "refund": {
      lines.push(L(await acctBySubtype(c, t.company_id, "sales_return"), base, 0));
      await taxLegs("out", true);
      lines.push(L(bank, 0, total));
      break;
    }
    case "transfer": {
      const to = await bankLedger(c, t.company_id, t.to_bank_account_id);
      lines.push(L(to, total, 0), L(bank, 0, total)); // internal movement: never touches income/expense
      break;
    }
    case "capital": lines.push(L(bank, total, 0), L(await acctBySubtype(c, t.company_id, "capital"), 0, total)); break;
    case "drawing": lines.push(L(await acctBySubtype(c, t.company_id, "capital"), total, 0), L(bank, 0, total)); break;
    case "loan_in": lines.push(L(bank, total, 0), L(await acctBySubtype(c, t.company_id, "loan"), 0, total)); break;
    case "loan_repay": lines.push(L(await acctBySubtype(c, t.company_id, "loan"), total, 0), L(bank, 0, total)); break;
  }
  return post(c, u, { companyId: t.company_id, date: t.txn_date, memo, source: "transaction", sourceId: t.id, lines });
}

function statusFor(u: SessionUser, i: TxnInput): "draft" | "pending_approval" | "posted" {
  if (i.as_draft) return "draft";
  if (i.kind === "income" && i.payment_status === "pending") return "draft"; // not received yet: stays out of the books
  if (i.kind === "expense" && !can(u, "txn.approve")) return "pending_approval";
  return "posted";
}

function permFor(u: SessionUser, kind: string) {
  need(u, BANK_KINDS.includes(kind) ? "bank.write" : "txn.write");
}

export async function createTxn(c: Client, u: SessionUser, i: TxnInput) {
  const companyId = writeCompany(u, i.company_id);
  permFor(u, i.kind);
  const co = await company(c, companyId);
  validate(i, co.gst_registered);
  const tax = r2(Number(i.tax_amount || 0)), tds = r2(Number(i.tds_amount || 0));
  const amount = r2(Number(i.base_amount) + tax);
  const fy = fyOf(i.txn_date);
  const no = await nextNo(c, companyId, `T-${KIND_CODE[i.kind]}`, fy);
  const txnNo = `${co.code}/${KIND_CODE[i.kind]}/${fy}/${String(no).padStart(4, "0")}`;
  const status = BANK_KINDS.includes(i.kind) || i.kind === "refund" ? (i.as_draft ? "draft" : "posted") : statusFor(u, i);
  if (i.category_id) await q1(c, "SELECT 1 FROM account_categories WHERE id=$1 AND company_id=$2", [i.category_id, companyId]).then((r) => { if (!r) throw new HttpError(400, "Category belongs to a different company"); });
  const row = await q1(
    c,
    `INSERT INTO transactions(company_id,txn_no,kind,txn_date,amount,tax_amount,tds_amount,tax_type,status,category_id,bank_account_id,to_bank_account_id,
       customer_id,vendor_id,party_name,invoice_no,payment_method,reference,description,recurring,next_run,project,payment_status,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
    [companyId, txnNo, i.kind, i.txn_date, amount, tax, tds, i.tax_type || "GST", status, i.category_id || null, i.bank_account_id, i.to_bank_account_id || null,
      i.customer_id || null, i.vendor_id || null, i.party_name || null, i.invoice_no || null, i.payment_method || null, i.reference || null, i.description || null,
      i.recurring || null, i.recurring ? addMonths(i.txn_date, i.recurring === "monthly" ? 1 : i.recurring === "quarterly" ? 3 : 12) : null,
      i.project || null, i.kind === "income" ? (status === "draft" ? "pending" : "received") : "paid", u.id]
  );
  if (status === "posted") {
    const je = await postRow(c, u, row);
    await c.query("UPDATE transactions SET journal_entry_id=$2 WHERE id=$1", [row.id, je]);
    row.journal_entry_id = je;
  }
  await audit(c, u, { action: "create", entity: "transaction", id: row.id, company: companyId, after: row });
  return row;
}

export async function updateTxn(c: Client, u: SessionUser, id: number, i: TxnInput) {
  const old = await q1(c, "SELECT * FROM transactions WHERE id=$1", [id]);
  if (!old) throw new HttpError(404, "Transaction not found");
  permFor(u, old.kind);
  if (old.status === "voided") throw new HttpError(409, "Voided transactions cannot be edited");
  if (!u.companyIds.includes(old.company_id)) throw new HttpError(403, "No access");
  if (i.company_id && Number(i.company_id) !== old.company_id) throw new HttpError(400, "A transaction cannot be moved to another company");
  i.kind = old.kind; i.company_id = old.company_id;
  const co = await company(c, old.company_id);
  validate(i, co.gst_registered);
  const tax = r2(Number(i.tax_amount || 0)), tds = r2(Number(i.tds_amount || 0));
  const amount = r2(Number(i.base_amount) + tax);
  // Posted rows are corrected with a reversal + fresh posting; the history stays in the ledger and audit log.
  let status = old.status as string;
  if (old.status === "posted") await reverse(c, u, old.journal_entry_id, `edit of ${old.txn_no}`);
  if (old.status === "posted" || old.status === "draft" || old.status === "pending_approval") {
    status = old.status === "posted" ? (old.kind === "expense" && !can(u, "txn.approve") ? "pending_approval" : "posted") : statusFor(u, { ...i, as_draft: false });
  }
  const row = await q1(
    c,
    `UPDATE transactions SET txn_date=$2, amount=$3, tax_amount=$4, tds_amount=$5, tax_type=$6, status=$7, category_id=$8, bank_account_id=$9, to_bank_account_id=$10,
       customer_id=$11, vendor_id=$12, party_name=$13, invoice_no=$14, payment_method=$15, reference=$16, description=$17, recurring=$18, project=$19, journal_entry_id=NULL, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, i.txn_date, amount, tax, tds, i.tax_type || "GST", status, i.category_id || null, i.bank_account_id, i.to_bank_account_id || null,
      i.customer_id || null, i.vendor_id || null, i.party_name || null, i.invoice_no || null, i.payment_method || null, i.reference || null, i.description || null, i.recurring || null, i.project || null]
  );
  if (status === "posted") {
    const je = await postRow(c, u, row);
    await c.query("UPDATE transactions SET journal_entry_id=$2 WHERE id=$1", [id, je]);
    row.journal_entry_id = je;
  }
  await audit(c, u, { action: "update", entity: "transaction", id, company: old.company_id, before: old, after: row });
  return row;
}

export async function approveTxn(c: Client, u: SessionUser, id: number, approve: boolean, note?: string) {
  need(u, "txn.approve");
  const t = await q1(c, "SELECT * FROM transactions WHERE id=$1", [id]);
  if (!t) throw new HttpError(404, "Not found");
  if (t.status !== "pending_approval" && !(t.status === "draft" && approve)) throw new HttpError(409, "Only pending items can be approved or rejected");
  if (approve) {
    const je = await postRow(c, u, t);
    await c.query("UPDATE transactions SET status='posted', journal_entry_id=$2, approved_by=$3, approved_at=now(), payment_status=CASE WHEN kind='income' THEN 'received' ELSE payment_status END WHERE id=$1", [id, je, u.id]);
  } else {
    await c.query("UPDATE transactions SET status='voided', voided_by=$2, voided_at=now(), void_reason=$3 WHERE id=$1", [id, u.id, note || "Rejected"]);
  }
  await audit(c, u, { action: approve ? "approve" : "reject", entity: "transaction", id, company: t.company_id, before: { status: t.status }, after: { status: approve ? "posted" : "voided" }, note });
}

export async function voidTxn(c: Client, u: SessionUser, id: number, reason: string) {
  const t = await q1(c, "SELECT * FROM transactions WHERE id=$1", [id]);
  if (!t) throw new HttpError(404, "Not found");
  permFor(u, t.kind);
  if (!reason || reason.trim().length < 3) throw new HttpError(400, "A reason is required to void a transaction");
  if (t.status === "voided") throw new HttpError(409, "Already voided");
  if (t.status === "posted") await reverse(c, u, t.journal_entry_id, `void ${t.txn_no}: ${reason}`);
  await c.query("UPDATE transactions SET status='voided', voided_by=$2, voided_at=now(), void_reason=$3 WHERE id=$1", [id, u.id, reason]);
  await audit(c, u, { action: "void", entity: "transaction", id, company: t.company_id, before: { status: t.status }, after: { status: "voided" }, note: reason });
}

export async function deleteDraftTxn(c: Client, u: SessionUser, id: number) {
  const t = await q1(c, "SELECT * FROM transactions WHERE id=$1", [id]);
  if (!t) throw new HttpError(404, "Not found");
  permFor(u, t.kind);
  if (t.status === "posted" || t.status === "voided") throw new HttpError(409, "Posted transactions can only be voided, never deleted");
  await c.query("DELETE FROM transactions WHERE id=$1", [id]);
  await audit(c, u, { action: "delete_draft", entity: "transaction", id, company: t.company_id, before: t });
}

/** Creates the next occurrence of every due recurring expense (as pending approval unless a super admin runs it). */
export async function runRecurring(c: Client, u: SessionUser, companyIds: number[]) {
  need(u, "txn.write");
  const due = await q(c, "SELECT * FROM transactions WHERE company_id=ANY($1) AND recurring IS NOT NULL AND next_run<=$2 AND status IN ('posted','pending_approval') ORDER BY id", [companyIds, today()]);
  let made = 0;
  for (const s of due) {
    let next = s.next_run as string;
    while (next <= today()) {
      await createTxn(c, u, {
        company_id: s.company_id, kind: s.kind, txn_date: next, base_amount: s.amount - s.tax_amount, tax_amount: s.tax_amount, tds_amount: s.tds_amount, tax_type: s.tax_type,
        category_id: s.category_id, bank_account_id: s.bank_account_id, customer_id: s.customer_id, vendor_id: s.vendor_id, party_name: s.party_name,
        payment_method: s.payment_method, description: `${s.description || ""} (recurring)`.trim(), project: s.project, reference: s.reference,
      });
      made++;
      next = addMonths(next, s.recurring === "monthly" ? 1 : s.recurring === "quarterly" ? 3 : 12);
    }
    await c.query("UPDATE transactions SET next_run=$2 WHERE id=$1", [s.id, next]);
  }
  return made;
}
