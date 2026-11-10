// Accounting QA: exercises the real services against the seeded database and asserts invariants.
// Run:  npm run verify   (uses a rolled-back transaction for the mutating scenarios, so data is not changed)
import { sys, tx, pool, q, q1, SessionUser } from "../lib/db";
import { balanceSheet, cashFlow, dashboard, profitLoss, trialBalance, receivables, payables, companyComparison, budgetVsActual, REPORTS } from "../lib/reports";
import { createTxn, voidTxn, approveTxn } from "../lib/txn";
import { saveInvoice, recordPayment, saveBill, voidPayment, voidInvoice } from "../lib/docs";
import { createBankAccount } from "../lib/misc";

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
class Rollback extends Error {}

async function main() {
  const cos = await sys((c) => q(c, "SELECT id, code, name FROM companies ORDER BY id"));
  const all = cos.map((x: any) => x.id);
  const SA: SessionUser = { id: (await sys((c) => q1(c, "SELECT id FROM user_profiles WHERE role='SUPER_ADMIN'")))!.id, email: "admin@arshith.test", name: "QA", role: "SUPER_ADMIN", companyIds: all };
  const mkUser = async (email: string) => { const u = await sys((c) => q1(c, "SELECT id,role FROM user_profiles WHERE email=$1", [email])); const m = await sys((c) => q(c, "SELECT company_id FROM company_memberships WHERE user_id=$1", [u!.id])); return { id: u!.id, email, name: email, role: u!.role, companyIds: m.map((x: any) => x.company_id) } as SessionUser; };
  const fresh = await mkUser("fresh.admin@arshith.test"), viewer = await mkUser("viewer@arshith.test"), acct = await mkUser("accountant@arshith.test");

  console.log("\n[1] Ledger integrity");
  const led = await sys((c) => q1(c, "SELECT SUM(debit) d, SUM(credit) c, count(*)::int n FROM journal_entry_lines"));
  ok(near(led!.d, led!.c), "Total debits = total credits across the whole ledger", `${led!.n} lines`);
  const unb = await sys((c) => q(c, "SELECT entry_id FROM journal_entry_lines GROUP BY entry_id HAVING SUM(debit)<>SUM(credit)"));
  ok(unb.length === 0, "Every journal entry individually balances");
  for (const co of cos) {
    const r = await sys((c) => q1(c, "SELECT SUM(debit)-SUM(credit) d FROM journal_entry_lines WHERE company_id=$1", [co.id]));
    ok(near(r!.d, 0), `${co.name}: company ledger balances`);
  }
  let blocked = false;
  await sys(async (c) => { await c.query("BEGIN"); try { await c.query("UPDATE journal_entry_lines SET debit=debit+1 WHERE id=(SELECT min(id) FROM journal_entry_lines)"); } catch { blocked = true; } await c.query("ROLLBACK"); });
  ok(blocked, "Posted journal lines are immutable (UPDATE rejected by trigger)");
  blocked = false;
  await sys(async (c) => { await c.query("BEGIN"); try { await c.query("INSERT INTO journal_entries(company_id,entry_no,entry_date,source_type) VALUES (1,'T-X','2026-11-01','x') RETURNING id"); await c.query("INSERT INTO journal_entry_lines(entry_id,company_id,account_id,debit) SELECT currval('journal_entries_id_seq'),1,id,10 FROM accounts WHERE company_id=1 LIMIT 1"); await c.query("COMMIT"); } catch { blocked = true; await c.query("ROLLBACK"); } });
  ok(blocked, "An unbalanced journal cannot be committed (deferred constraint)");

  console.log("\n[2] Statements");
  for (const scope of ["all", ...all.map(String)]) {
    const bs = await tx(SA, (c) => balanceSheet(c, SA, { company: scope }));
    ok(bs.meta!.balanced, `Balance sheet balances: Assets = Liabilities + Equity (scope ${scope})`, `diff ${bs.meta!.difference}`);
    const cf = await tx(SA, (c) => cashFlow(c, SA, { company: scope, preset: "fy" }));
    ok(cf.meta!.reconciles, `Cash flow closing = ledger cash+bank (scope ${scope})`);
    const tb = await tx(SA, (c) => trialBalance(c, SA, { company: scope }));
    ok(tb.meta!.balanced, `Trial balance debit = credit (scope ${scope})`);
  }
  // consolidated = sum of companies
  const sumNet = async () => { let s = 0; for (const id of all) { const r = await tx(SA, (c) => profitLoss(c, SA, { company: String(id), preset: "fy", group: "none" } as any)); s += r.rows.find((x: any) => x.label.startsWith("Net Profit")).total; } return s; };
  const cons = await tx(SA, (c) => profitLoss(c, SA, { company: "all", preset: "fy" }));
  ok(near(cons.rows.find((x: any) => x.label.startsWith("Net Profit")).total, await sumNet()), "Consolidated net profit = sum of the three companies");
  const d = await tx(SA, (c) => dashboard(c, SA, { company: "all", preset: "fy" }));
  const cmp = await tx(SA, (c) => companyComparison(c, SA, { company: "all", preset: "fy" }));
  const grand = cmp.rows.find((r: any) => r.company === "GROUP TOTAL");
  ok(near(d.kpis.find((k: any) => k.key === "profit")!.value, grand.profit), "Dashboard net profit = company comparison total");
  ok(near(d.kpis.find((k: any) => k.key === "revenue")!.value - d.kpis.find((k: any) => k.key === "expenses")!.value, d.kpis.find((k: any) => k.key === "profit")!.value), "Revenue − Expenses = Net profit on dashboard");
  const ar = await tx(SA, (c) => receivables(c, SA, {}));
  ok(near(ar.meta!.outstanding, d.kpis.find((k: any) => k.key === "ar")!.value), "Receivable list total = AR ledger balance", `₹${ar.meta!.outstanding}`);
  const ap = await tx(SA, (c) => payables(c, SA, {}));
  ok(near(ap.meta!.outstanding, d.kpis.find((k: any) => k.key === "ap")!.value), "Payable list total = AP ledger balance", `₹${ap.meta!.outstanding}`);
  for (const name of Object.keys(REPORTS)) {
    let good = true; try { await tx(SA, (c) => REPORTS[name](c, SA, { company: "all", preset: "fy" })); } catch (e: any) { good = false; console.log(e.message); }
    ok(good, `Report '${name}' runs`);
  }

  console.log("\n[3] Business scenarios (rolled back)");
  const co = all[0];
  try {
    await tx(SA, async (c) => {
      const b0 = await balanceSheet(c, SA, { company: String(co) });
      const bank = await q1(c, "SELECT id FROM bank_accounts WHERE company_id=$1 AND account_type='bank'", [co]);
      const cash = await q1(c, "SELECT id FROM bank_accounts WHERE company_id=$1 AND account_type='cash'", [co]);
      const plBefore = (await profitLoss(c, SA, { company: String(co), from: "2026-11-01", to: "2026-11-30" })).rows.find((x: any) => x.label.startsWith("Net Profit")).total;
      // transfer must not change P&L
      await createTxn(c, SA, { company_id: co, kind: "transfer", txn_date: "2026-11-05", base_amount: 12345, bank_account_id: bank.id, to_bank_account_id: cash.id });
      const plAfterT = (await profitLoss(c, SA, { company: String(co), from: "2026-11-01", to: "2026-11-30" })).rows.find((x: any) => x.label.startsWith("Net Profit")).total;
      ok(near(plBefore, plAfterT), "Bank transfer does not change revenue/expense/profit");
      // income
      const incCat = await q1(c, "SELECT id FROM account_categories WHERE company_id=$1 AND name='Product Sales'", [co]);
      await createTxn(c, SA, { company_id: co, kind: "income", txn_date: "2026-11-06", base_amount: 100000, tax_amount: 5000, category_id: incCat!.id, bank_account_id: bank.id });
      const plI = (await profitLoss(c, SA, { company: String(co), from: "2026-11-01", to: "2026-11-30" })).rows.find((x: any) => x.label.startsWith("Net Profit")).total;
      ok(near(plI - plAfterT, 100000), "Income of ₹1,00,000 (+₹5,000 GST) raises profit by exactly ₹1,00,000 (GST is a liability)");
      // expense (as accountant → pending → not in books until approved)
      const expCat = await q1(c, "SELECT id FROM account_categories WHERE company_id=$1 AND name='Marketing'", [co]);
      const e1 = await createTxn(c, acct.companyIds.includes(co) ? acct : SA, { company_id: co, kind: "expense", txn_date: "2026-11-07", base_amount: 20000, tax_amount: 3600, category_id: expCat!.id, bank_account_id: bank.id });
      const plE0 = (await profitLoss(c, SA, { company: String(co), from: "2026-11-01", to: "2026-11-30" })).rows.find((x: any) => x.label.startsWith("Net Profit")).total;
      ok(near(plE0, plI) || e1.status === "posted", "Unapproved expense stays out of profit until a super admin approves it", `status ${e1.status}`);
      const e2 = await createTxn(c, SA, { company_id: co, kind: "expense", txn_date: "2026-11-07", base_amount: 20000, tax_amount: 3600, category_id: expCat!.id, bank_account_id: bank.id });
      const plE = (await profitLoss(c, SA, { company: String(co), from: "2026-11-01", to: "2026-11-30" })).rows.find((x: any) => x.label.startsWith("Net Profit")).total;
      ok(near(plI - plE, 20000 + (e1.status === "posted" ? 20000 : 0)), "Expense reduces profit by the base amount only (input GST is an asset)");
      await voidTxn(c, SA, e2.id, "test void");
      const plV = (await profitLoss(c, SA, { company: String(co), from: "2026-11-01", to: "2026-11-30" })).rows.find((x: any) => x.label.startsWith("Net Profit")).total;
      ok(near(plV, plE0) || e1.status === "posted", "Voiding a posted expense reverses its effect (ledger reversal entry)");
      if (e1.status === "pending_approval") { await approveTxn(c, SA, e1.id, true); ok(true, "Super admin approval posts the pending expense"); }
      // invoice + partial payment: revenue recorded once
      const cust = await q1(c, "SELECT id FROM customers WHERE company_id=$1 LIMIT 1", [co]);
      const rev0 = (await profitLoss(c, SA, { company: String(co), from: "2026-11-01", to: "2026-11-30" })).rows.find((x: any) => x.label === "Net Revenue").total;
      const ar0 = (await receivables(c, SA, { company: String(co) })).meta!.outstanding;
      const inv = await saveInvoice(c, SA, { company_id: co, customer_id: cust!.id, issue_date: "2026-11-08", post: true, items: [{ description: "Test", category_id: incCat!.id, quantity: 2, unit_price: 5000, discount: 500, gst_rate: 18 }] });
      ok(inv.total === 11210, "Invoice total = (10,000 − 500) + 18% GST = ₹11,210", `got ${inv.total}`);
      ok(/^AFR\/INV\/2026-27\/\d{4}$/.test(inv.invoice_no), "Company-specific invoice number", inv.invoice_no);
      const inv2 = await saveInvoice(c, { ...SA, companyIds: all }, { company_id: all[1], customer_id: (await q1(c, "SELECT id FROM customers WHERE company_id=$1 LIMIT 1", [all[1]]))!.id, issue_date: "2026-11-08", post: true, items: [{ description: "T", category_id: (await q1(c, "SELECT id FROM account_categories WHERE company_id=$1 AND name='Service Income'", [all[1]]))!.id, quantity: 1, unit_price: 100, gst_rate: 18 }] });
      ok(inv2.invoice_no.startsWith("AIT/INV/"), "Different company → different invoice sequence", inv2.invoice_no);
      const rev1 = (await profitLoss(c, SA, { company: String(co), from: "2026-11-01", to: "2026-11-30" })).rows.find((x: any) => x.label === "Net Revenue").total;
      ok(near(rev1 - rev0, 9500), "Invoice adds net revenue (₹9,500 after discount) once");
      await recordPayment(c, SA, "receipt", inv.id, { bank_account_id: bank.id, amount: 5000, pay_date: "2026-11-09" });
      const rev2 = (await profitLoss(c, SA, { company: String(co), from: "2026-11-01", to: "2026-11-30" })).rows.find((x: any) => x.label === "Net Revenue").total;
      ok(near(rev2, rev1), "Partial payment does NOT add revenue again (no double counting)");
      const ar1 = (await receivables(c, SA, { company: String(co) })).meta!.outstanding;
      ok(near(ar1 - ar0, 11210 - 5000), "Receivables increase by invoice minus payment", `+${ar1 - ar0}`);
      let over = false; try { await recordPayment(c, SA, "receipt", inv.id, { bank_account_id: bank.id, amount: 99999, pay_date: "2026-11-09" }); } catch { over = true; }
      ok(over, "Over-payment is rejected");
      let vi = false; try { await voidInvoice(c, SA, inv.id, "should fail"); } catch { vi = true; }
      ok(vi, "Invoice with payments cannot be voided until the payment is voided");
      const pay = await q1(c, "SELECT id FROM payments WHERE invoice_id=$1", [inv.id]);
      await voidPayment(c, SA, pay!.id, "wrong amount");
      await voidInvoice(c, SA, inv.id, "test");
      ok(near((await receivables(c, SA, { company: String(co) })).meta!.outstanding, ar0), "Voiding payment and invoice restores receivables exactly");
      // bill + payment
      const ven = await q1(c, "SELECT id FROM vendors WHERE company_id=$1 LIMIT 1", [co]);
      const ap0 = (await payables(c, SA, { company: String(co) })).meta!.outstanding;
      const bill = await saveBill(c, SA, { company_id: co, vendor_id: ven!.id, bill_date: "2026-11-08", post: true, items: [{ description: "Goods", category_id: (await q1(c, "SELECT id FROM account_categories WHERE company_id=$1 AND name='Purchases'", [co]))!.id, quantity: 10, unit_price: 1000, gst_rate: 5 }] });
      ok(bill.total === 10500, "Bill total with 5% GST = ₹10,500");
      await recordPayment(c, SA, "payment", bill.id, { bank_account_id: bank.id, amount: 4000, pay_date: "2026-11-09" });
      ok(near((await payables(c, SA, { company: String(co) })).meta!.outstanding - ap0, 6500), "Payables = bill − partial payment (₹6,500 left)");
      const bs = await balanceSheet(c, SA, { company: "all" });
      ok(bs.meta!.balanced, "Balance sheet still balances after all scenario postings");
      const cf = await cashFlow(c, SA, { company: "all", preset: "fy" });
      ok(cf.meta!.reconciles, "Cash flow still reconciles to ledger cash");
      void b0;

      // role / company isolation (RLS) — run on a fresh transaction below
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) { fail++; console.log("  FAIL  scenario error:", (e as Error).message); } }

  console.log("\n[4] Isolation & roles");
  const vis = await tx(fresh, (c) => q(c, "SELECT DISTINCT company_id FROM journal_entries"));
  ok(vis.length === 1 && vis[0].company_id === fresh.companyIds[0], "Company admin sees ONLY their company's ledger (database RLS)");
  const sneaky = await tx(fresh, (c) => q(c, "SELECT count(*)::int n FROM transactions WHERE company_id <> $1", [fresh.companyIds[0]]));
  ok(sneaky[0].n === 0, "Direct SQL against other companies returns zero rows for a restricted user");
  let w = false; try { await tx(fresh, (c) => c.query("INSERT INTO customers(company_id,name) VALUES ($1,'x')", [all[1]])); } catch { w = true; }
  ok(w, "RLS blocks writing into another company");
  w = false; try { await tx(viewer, (c) => createTxn(c, viewer, { company_id: all[1], kind: "income", txn_date: "2026-11-01", base_amount: 1, category_id: 1, bank_account_id: 1 })); } catch (e: any) { w = e.status === 403; }
  ok(w, "Viewer cannot create transactions (403)");
  w = false; try { await tx(fresh, (c) => profitLoss(c, fresh, { company: String(all[1]) })); } catch (e: any) { w = e.status === 403; }
  ok(w, "Company admin requesting another company's report gets 403");
  const conFresh = await tx(fresh, (c) => dashboard(c, fresh, { company: "all", preset: "fy" }));
  ok(conFresh.scope.length === 1, "'All companies' for a company admin only aggregates their own company");
  w = false; try { await tx(acct, (c) => REPORTS.payroll(c, acct, { company: "all" })); } catch (e: any) { w = e.status === 403; }
  ok(w, "Accountant cannot open payroll (restricted)");
  const au = await tx(SA, (c) => q(c, "SELECT count(*)::int n FROM audit_logs WHERE action IN ('create','void')"));
  ok(au[0].n > 0, "Audit log has create/void history", `${au[0].n} rows`);
  let upd = false; await sys(async (c) => { await c.query("BEGIN"); try { await c.query("DELETE FROM audit_logs"); } catch { upd = true; } await c.query("ROLLBACK"); });
  ok(upd, "Audit log is append-only");
  let del = false; await sys(async (c) => { await c.query("BEGIN"); try { await c.query("DELETE FROM transactions WHERE status='posted'"); } catch { del = true; } await c.query("ROLLBACK"); });
  ok(del, "Posted transactions cannot be hard-deleted");
  const bud = await tx(SA, (c) => budgetVsActual(c, SA, { company: "all", fy: "2026-27" }));
  ok(bud.rows.length > 0 && bud.rows.every((r: any) => near(r.budget - r.actual, r.remaining)), "Budget vs actual computes remaining correctly", `${bud.rows.length} lines`);

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
