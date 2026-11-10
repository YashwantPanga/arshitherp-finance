// HTTP end-to-end checks against a running server:  BASE=http://localhost:3100 npx tsx scripts/e2e.ts
import ExcelJS from "exceljs";

const BASE = process.env.BASE || "http://localhost:3100";
let pass = 0, fail = 0;
const ok = (c: boolean, n: string, x = "") => { c ? pass++ : fail++; console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "  — " + x : ""}`); };

class Client {
  cookie = "";
  async req(method: string, path: string, body?: any, headers: Record<string, string> = {}) {
    const res = await fetch(BASE + "/api" + path, { method, headers: { ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}), cookie: this.cookie, ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, redirect: "manual" });
    const sc = res.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    return res;
  }
  async json(method: string, path: string, body?: any) { const r = await this.req(method, path, body); const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch {} return { status: r.status, body: j }; }
  async login(email: string, password: string) { return this.json("POST", "/auth/login", { email, password }); }
}

async function main() {
  const admin = new Client(), fresh = new Client(), acct = new Client(), viewer = new Client();
  console.log("\n[Auth]");
  ok((await admin.login("admin@arshith.test", "Admin@12345")).status === 200, "Super admin can sign in");
  ok((await fresh.login("fresh.admin@arshith.test", "Demo@12345")).status === 200, "Company admin can sign in");
  ok((await acct.login("accountant@arshith.test", "Demo@12345")).status === 200, "Accountant can sign in");
  ok((await viewer.login("viewer@arshith.test", "Demo@12345")).status === 200, "Viewer can sign in");
  ok((await new Client().json("GET", "/dashboard")).status === 401, "API rejects unauthenticated calls (401)");
  ok((await new Client().login("admin@arshith.test", "wrong")).status === 401, "Wrong password rejected");
  const evil = await admin.req("POST", "/transactions", {}, { Origin: "https://evil.example" });
  ok(evil.status === 403, "Cross-site POST blocked (CSRF origin check)");

  console.log("\n[Lockout & password reset]");
  const tmp = `tmp${Date.now()}@arshith.test`;
  const created = await admin.json("POST", "/users", { email: tmp, name: "Temp User", role: "VIEWER", password: "Temp@123456", company_ids: [1] });
  ok(created.status === 200, "Admin can create a user");
  const weak = await admin.json("POST", "/users", { email: "weak@arshith.test", name: "Weak", role: "VIEWER", password: "short", company_ids: [1] });
  ok(weak.status === 400, "Weak password rejected");
  let last = 0; for (let i = 0; i < 6; i++) last = (await new Client().login(tmp, "nope")).status;
  ok(last === 429, "Account locks after repeated failures (429)");
  const f = await new Client().json("POST", "/auth/forgot", { email: tmp });
  if (f.body.devToken) {
    ok(f.status === 200, "Forgot-password issues a single-use token (development mode returns it for testing)");
    const rs = await new Client().json("POST", "/auth/reset", { token: f.body.devToken, password: "NewPass@12345" });
    ok(rs.status === 200, "Reset token sets a new password");
    ok((await new Client().json("POST", "/auth/reset", { token: f.body.devToken, password: "Another@12345" })).status === 400, "Reset token cannot be reused");
    ok((await new Client().login(tmp, "NewPass@12345")).status === 200, "New password works and clears the lock");
  } else {
    ok(f.status === 200, "Production mode never reveals the reset token in the API response (only logged server-side)");
    ok((await new Client().json("POST", "/auth/reset", { token: "bogus", password: "NewPass@12345" })).status === 400, "Invalid reset token is rejected");
  }
  const unknown = await new Client().json("POST", "/auth/forgot", { email: "nobody@arshith.test" });
  ok(unknown.status === 200 && unknown.body.message === f.body.message, "Forgot-password response does not reveal whether an email exists");

  console.log("\n[Authorization]");
  ok((await fresh.json("GET", "/dashboard?company=2")).status === 403, "Company admin cannot read another company's dashboard");
  ok((await fresh.json("GET", "/transactions?company=2")).status === 403, "Company admin cannot list another company's transactions");
  const fd = await fresh.json("GET", "/dashboard?company=all&preset=fy");
  ok(fd.status === 200 && fd.body.scope.length === 1, "'All companies' for a company admin = only their company");
  ok((await viewer.json("POST", "/transactions", { company_id: 2, kind: "income" })).status === 403, "Viewer cannot write");
  ok((await viewer.json("GET", "/payroll")).status === 403, "Viewer cannot open payroll");
  ok((await acct.json("GET", "/payroll")).status === 403, "Accountant cannot open payroll");
  ok((await acct.json("GET", "/users")).status === 403, "Accountant cannot manage users");
  ok((await fresh.json("GET", "/users")).status === 403, "Company admin cannot manage users");
  ok((await acct.json("POST", "/companies", { code: "ZZZ", name: "Nope" })).status === 403, "Accountant cannot create companies");
  ok((await acct.json("GET", "/audit")).status === 403, "Accountant cannot read the audit log");

  console.log("\n[Expense approval workflow]");
  const meta = (await admin.json("GET", "/meta")).body;
  const co = 2, cat = meta.categories.find((c: any) => c.company_id === co && c.kind === "expense" && c.name === "Marketing").id;
  const bank = meta.banks.find((b: any) => b.company_id === co && b.account_type === "bank").id;
  const dash = async (p = "fy") => (await admin.json("GET", `/dashboard?company=${co}&preset=${p}`)).body;
  const profit0 = (await dash()).kpis.find((k: any) => k.key === "profit").value;
  const exp = await acct.json("POST", "/transactions", { company_id: co, kind: "expense", txn_date: "2026-11-09", base_amount: 10000, tax_amount: 1800, category_id: cat, bank_account_id: bank, payment_method: "UPI", description: "e2e marketing" });
  ok(exp.status === 200 && exp.body.status === "pending_approval", "Accountant's expense goes to 'pending approval'", exp.body?.status);
  ok(Math.abs((await dash()).kpis.find((k: any) => k.key === "profit").value - profit0) < 0.005, "Pending expense does not change profit");
  ok((await acct.json("POST", `/transactions/${exp.body.id}/approve`, {})).status === 403, "Accountant cannot approve");
  ok((await admin.json("POST", `/transactions/${exp.body.id}/approve`, {})).status === 200, "Super admin approves");
  ok(Math.abs(profit0 - (await dash()).kpis.find((k: any) => k.key === "profit").value - 10000) < 0.005, "Approved expense reduces profit by ₹10,000");
  const del = await admin.json("DELETE", `/transactions/${exp.body.id}`);
  ok(del.status === 409, "Posted transaction cannot be deleted (409)", del.body?.error);
  ok((await admin.json("POST", `/transactions/${exp.body.id}/void`, { reason: "" })).status === 400, "Void needs a reason");
  ok((await admin.json("POST", `/transactions/${exp.body.id}/void`, { reason: "e2e cleanup" })).status === 200, "Void with reason works");
  const hist = (await admin.json("GET", `/transactions/${exp.body.id}`)).body.history.map((h: any) => h.action);
  ok(["create", "approve", "void"].every((a) => hist.includes(a)), "Audit history records create → approve → void", hist.join(", "));

  console.log("\n[Exports]");
  for (const name of ["profit-loss", "balance-sheet", "cash-flow", "income", "expense", "receivables", "payables", "tax", "payroll", "budget-vs-actual", "company-comparison", "by-project", "monthly", "annual", "trial-balance"]) {
    const json = (await admin.json("GET", `/reports/${name}?company=all&preset=fy`)).body;
    const x = await admin.req("GET", `/reports/${name}/export?company=all&preset=fy&format=xlsx`);
    const buf = Buffer.from(await x.arrayBuffer());
    let rows = -1; try { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); rows = wb.worksheets[0].rowCount - 5; } catch {}
    ok(x.status === 200 && rows === json.rows.length, `Excel export '${name}' matches on-screen rows`, `${rows}/${json.rows.length}`);
    const p = await admin.req("GET", `/reports/${name}/export?company=all&preset=fy&format=pdf`); const pb = Buffer.from(await p.arrayBuffer());
    ok(p.status === 200 && pb.subarray(0, 4).toString() === "%PDF", `PDF export '${name}' is a valid PDF`, `${pb.length} bytes`);
  }
  const csv = await (await admin.req("GET", "/reports/income/export?company=1&preset=fy&format=csv")).text();
  ok(csv.split("\r\n").length > 10, "CSV export works");
  const tx = await admin.req("GET", "/transactions/export?kind=income&company=1&preset=fy&format=xlsx");
  const tj = (await admin.json("GET", "/transactions?kind=income&company=1&preset=fy&pageSize=200")).body;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await tx.arrayBuffer()) as any);
  ok(wb.worksheets[0].rowCount - 5 === tj.total, "Income list export row count equals filtered list total", `${wb.worksheets[0].rowCount - 5}/${tj.total}`);
  const inv = (await admin.json("GET", "/invoices?company=1&pageSize=5")).body.rows[0];
  const ip = await admin.req("GET", `/invoices/${inv.id}/pdf`); const ipb = Buffer.from(await ip.arrayBuffer());
  ok(ip.status === 200 && ipb.subarray(0, 4).toString() === "%PDF", "Invoice PDF generated", `${inv.invoice_no}`);
  const pr = (await admin.json("GET", "/payroll")).body[0];
  const prd = (await admin.json("GET", `/payroll/${pr.id}`)).body;
  const ps = await admin.req("GET", `/payroll/items/${prd.items[0].id}/payslip`);
  ok(ps.status === 200 && (await ps.arrayBuffer()).byteLength > 1000, "Payslip PDF generated");

  console.log("\n[Uploads]");
  const t1 = (await admin.json("GET", "/transactions?kind=income&company=1&pageSize=1")).body.rows[0];
  const bad = new FormData(); bad.append("file", new Blob(["<script>alert(1)</script>"], { type: "image/png" }), "evil.png"); bad.append("entity_type", "transaction"); bad.append("entity_id", String(t1.id));
  ok((await admin.req("POST", "/attachments", bad)).status === 415, "Non-image disguised as PNG is rejected (magic-byte check)");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const good = new FormData(); good.append("file", new Blob([png], { type: "image/png" }), "../../receipt.png"); good.append("entity_type", "transaction"); good.append("entity_id", String(t1.id));
  const up = await admin.json("POST", "/attachments", good);
  ok(up.status === 200 && !up.body.filename.includes(".."), "Valid PNG accepted, filename sanitised", up.body?.filename);
  const dl = await admin.req("GET", `/attachments/${up.body.id}`);
  ok(dl.status === 200 && dl.headers.get("x-content-type-options") === "nosniff", "Attachment served with nosniff");
  const big = new FormData(); big.append("file", new Blob([Buffer.alloc(6 * 1024 * 1024, 1)]), "big.png"); big.append("entity_type", "transaction"); big.append("entity_id", String(t1.id));
  ok((await admin.req("POST", "/attachments", big)).status === 413, "Oversize file rejected");
  ok((await acct.req("GET", `/attachments/${up.body.id}`)).status === 404, "Other company's attachment is invisible to an unauthorised user");

  console.log("\n[Financial periods]");
  const per = meta.periods.find((p: any) => p.company_id === 1 && p.label === "2024-25");
  ok((await admin.json("POST", `/periods/${per.id}/status`, { status: "closed" })).status === 200, "Super admin closes a period");
  const blocked = await admin.json("POST", "/transactions", { company_id: 1, kind: "capital", txn_date: "2024-06-01", base_amount: 100, bank_account_id: meta.banks.find((b: any) => b.company_id === 1).id });
  ok(blocked.status === 409, "Posting into a closed period is refused", blocked.body?.error);
  await admin.json("POST", `/periods/${per.id}/status`, { status: "open" });

  console.log("\n[Backup]");
  const bk = await admin.json("POST", "/admin/backups", {});
  ok(bk.status === 200 && bk.body.size > 1000, "Database backup created", bk.body?.file || bk.body?.error);

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
