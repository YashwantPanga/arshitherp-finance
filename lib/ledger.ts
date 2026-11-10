// Double-entry engine: every posted business event goes through post(); corrections go through reverse().
import { Client, HttpError, SessionUser, q, q1 } from "./db";
import { fyOf, nextNo, toPaise, fromPaise } from "./core";

export interface Line { account_id: number; debit?: number; credit?: number; memo?: string }

export async function audit(
  c: Client, u: SessionUser | null,
  a: { action: string; entity: string; id?: number | string; company?: number | null; before?: unknown; after?: unknown; note?: string }
) {
  await c.query(
    "INSERT INTO audit_logs(user_id,user_email,company_id,action,entity_type,entity_id,before,after,note,ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [u?.id ?? null, u?.email ?? null, a.company ?? null, a.action, a.entity, a.id != null ? String(a.id) : null,
      a.before ? JSON.stringify(a.before) : null, a.after ? JSON.stringify(a.after) : null, a.note ?? null, u?.ip ?? null]
  );
}

export async function post(
  c: Client, u: SessionUser,
  e: { companyId: number; date: string; memo: string; source: string; sourceId?: number; reverses?: number; lines: Line[] }
): Promise<number> {
  const lines = e.lines.filter((l) => toPaise(l.debit) || toPaise(l.credit));
  const d = lines.reduce((s, l) => s + toPaise(l.debit), 0);
  const cr = lines.reduce((s, l) => s + toPaise(l.credit), 0);
  if (lines.length < 2 || d !== cr) throw new HttpError(500, `Unbalanced journal (debit ${fromPaise(d)} vs credit ${fromPaise(cr)})`);
  const fy = fyOf(e.date);
  const n = await nextNo(c, e.companyId, "JE", fy);
  const entry = await q1<{ id: number }>(
    c,
    "INSERT INTO journal_entries(company_id,entry_no,entry_date,memo,source_type,source_id,created_by,reverses_entry_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [e.companyId, `JE/${fy}/${String(n).padStart(5, "0")}`, e.date, e.memo, e.source, e.sourceId ?? null, u.id, e.reverses ?? null]
  );
  const vals: any[] = [];
  const ph = lines.map((l, i) => {
    vals.push(entry!.id, e.companyId, l.account_id, fromPaise(toPaise(l.debit)), fromPaise(toPaise(l.credit)), l.memo ?? null);
    const o = i * 6;
    return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6})`;
  });
  try {
    await c.query(`INSERT INTO journal_entry_lines(entry_id,company_id,account_id,debit,credit,memo) VALUES ${ph.join(",")}`, vals);
  } catch (err: any) {
    if (/closed/.test(err.message)) throw new HttpError(409, err.message);
    throw err;
  }
  return entry!.id;
}

/** Void = post an exact mirror entry on the original date and mark the original as reversed. */
export async function reverse(c: Client, u: SessionUser, entryId: number, memo: string): Promise<number> {
  const je = await q1(c, "SELECT * FROM journal_entries WHERE id=$1", [entryId]);
  if (!je) throw new HttpError(404, "Journal entry not found");
  if (je.status === "reversed") throw new HttpError(409, "Entry is already reversed");
  const lines = await q(c, "SELECT account_id,debit,credit,memo FROM journal_entry_lines WHERE entry_id=$1", [entryId]);
  const rid = await post(c, u, {
    companyId: je.company_id, date: je.entry_date, memo: `REVERSAL: ${memo}`, source: je.source_type, sourceId: je.source_id, reverses: entryId,
    lines: lines.map((l: any) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, memo: l.memo })),
  });
  await c.query("UPDATE journal_entries SET status='reversed' WHERE id=$1", [entryId]);
  return rid;
}

// ---- Account lookups ----
export async function acctBySubtype(c: Client, companyId: number, subtype: string): Promise<number> {
  const r = await q1<{ id: number }>(c, "SELECT id FROM accounts WHERE company_id=$1 AND subtype=$2 AND active ORDER BY is_system DESC, code LIMIT 1", [companyId, subtype]);
  if (!r) throw new HttpError(500, `Chart of accounts is missing a '${subtype}' account for this company`);
  return r.id;
}
export async function bankLedger(c: Client, companyId: number, bankAccountId: number): Promise<number> {
  const r = await q1<{ account_id: number }>(c, "SELECT account_id FROM bank_accounts WHERE id=$1 AND company_id=$2 AND active", [bankAccountId, companyId]);
  if (!r) throw new HttpError(400, "Bank/cash account not found for this company");
  return r.account_id;
}
export async function categoryAccount(c: Client, companyId: number, categoryId: number, kind: "income" | "expense"): Promise<number> {
  const r = await q1<{ account_id: number }>(c, "SELECT account_id FROM account_categories WHERE id=$1 AND company_id=$2 AND kind=$3 AND active", [categoryId, companyId, kind]);
  if (!r) throw new HttpError(400, `Invalid ${kind} category for this company`);
  return r.account_id;
}

/** Split a GST amount into CGST/SGST/IGST ledger legs. */
export function splitTax(taxPaise: number, taxType: string) {
  if (taxType === "IGST") return { cgst: 0, sgst: 0, igst: taxPaise };
  if (taxType === "NONE") return { cgst: 0, sgst: 0, igst: 0 };
  const cg = Math.floor(taxPaise / 2);
  return { cgst: cg, sgst: taxPaise - cg, igst: 0 };
}

/** Physical cash cannot go below zero (bank accounts may overdraw, so they are not blocked). */
export async function assertFunds(c: Client, bankAccountId: number, amount: number) {
  const r = await q1<{ account_type: string; name: string; bal: number }>(
    c, "SELECT ba.account_type, ba.name, COALESCE((SELECT SUM(debit-credit) FROM journal_entry_lines l WHERE l.account_id=ba.account_id),0) AS bal FROM bank_accounts ba WHERE ba.id=$1", [bankAccountId]);
  if (r && r.account_type === "cash" && toPaise(r.bal) < toPaise(amount))
    throw new HttpError(409, `Insufficient cash in "${r.name}" (available ${r.bal.toFixed(2)})`);
}
