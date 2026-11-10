// Generates docs/Arshith-ERP-How-It-Works.pdf  (npm run guide)
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

const OUT = path.join(process.cwd(), "docs", "Arshith-ERP-How-It-Works.pdf");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: "Arshith Group Finance ERP - How it works", Author: "Arshith Group Finance ERP" } });
doc.pipe(fs.createWriteStream(OUT));

const GREEN = "#00A76F", DARK = "#212B36", GREY = "#637381", LIGHT = "#F4F6F8", LINE = "#DFE3E8", BLUE = "#2065D1", ORANGE = "#FF9F1A", RED = "#FF5630", PURPLE = "#7A4CD6";
const W = () => doc.page.width - 96;
const need = (h: number) => { if (doc.y + h > doc.page.height - 60) doc.addPage(); };

function H1(t: string, sub?: string) {
  doc.addPage();
  doc.rect(0, 0, doc.page.width, 78).fill(GREEN);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(22).text(t, 48, 26, { width: W() });
  if (sub) doc.font("Helvetica").fontSize(10).fillColor("#D6F5E8").text(sub, 48, 56);
  doc.fillColor(DARK).y = 100;
}
function H2(t: string) { need(60); doc.moveDown(0.6); doc.font("Helvetica-Bold").fontSize(13).fillColor(GREEN).text(t, 48, doc.y, { width: W() }); doc.moveDown(0.25); doc.fillColor(DARK); }
function H3(t: string) { need(40); doc.moveDown(0.3); doc.font("Helvetica-Bold").fontSize(10.5).fillColor(DARK).text(t, 48, doc.y, { width: W() }); doc.moveDown(0.1); }
function P(t: string, o: { color?: string; size?: number } = {}) { need(30); doc.font("Helvetica").fontSize(o.size || 10).fillColor(o.color || DARK).text(t, 48, doc.y, { width: W(), lineGap: 2.2 }); doc.moveDown(0.5); }
function B(items: string[], o: { size?: number } = {}) {
  for (const it of items) {
    need(24); const y = doc.y; doc.circle(54, y + 5.2, 1.9).fill(GREEN);
    doc.fillColor(DARK).font("Helvetica").fontSize(o.size || 10).text(it, 66, y, { width: W() - 20, lineGap: 2 }); doc.moveDown(0.25);
  }
  doc.moveDown(0.3);
}
function Code(t: string) {
  const h = doc.heightOfString(t, { width: W() - 20, lineGap: 1.5 }) + 14; need(h + 6);
  const y = doc.y; doc.roundedRect(48, y, W(), h, 5).fill("#212B36");
  doc.fillColor("#C8FAD6").font("Courier").fontSize(8.6).text(t, 58, y + 7, { width: W() - 20, lineGap: 1.5 }); doc.y = y + h + 8; doc.fillColor(DARK);
}
function Note(t: string, color = ORANGE) {
  const h = doc.heightOfString(t, { width: W() - 30, lineGap: 2 }) + 16; need(h + 6);
  const y = doc.y; doc.roundedRect(48, y, W(), h, 5).fill(color === ORANGE ? "#FFF5E5" : color === RED ? "#FFECE8" : "#E8F8F0");
  doc.rect(48, y, 4, h).fill(color); doc.fillColor(DARK).font("Helvetica").fontSize(9.5).text(t, 62, y + 8, { width: W() - 30, lineGap: 2 }); doc.y = y + h + 8;
}
function Table(head: string[], rows: string[][], widths: number[], o: { size?: number } = {}) {
  const sz = o.size || 8.6, tot = widths.reduce((a, b) => a + b, 0), cw = widths.map((w) => (w / tot) * W());
  const rowH = (r: string[], bold = false) => Math.max(...r.map((c, i) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(sz).heightOfString(c, { width: cw[i] - 8 }))) + 8;
  const header = () => { const h = rowH(head, true); need(h + 20); const y = doc.y; doc.rect(48, y, W(), h).fill(GREEN); let x = 48; head.forEach((c, i) => { doc.fillColor("#fff").font("Helvetica-Bold").fontSize(sz).text(c, x + 4, y + 4, { width: cw[i] - 8 }); x += cw[i]; }); doc.y = y + h; };
  header();
  rows.forEach((r, ri) => {
    const h = rowH(r); if (doc.y + h > doc.page.height - 60) { doc.addPage(); header(); }
    const y = doc.y; if (ri % 2) doc.rect(48, y, W(), h).fill(LIGHT);
    let x = 48; r.forEach((c, i) => { doc.fillColor(DARK).font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(sz).text(c, x + 4, y + 4, { width: cw[i] - 8 }); x += cw[i]; });
    doc.moveTo(48, y + h).lineTo(48 + W(), y + h).lineWidth(0.3).strokeColor(LINE).stroke(); doc.y = y + h;
  });
  doc.moveDown(0.7);
}
function Box(x: number, y: number, w: number, h: number, title: string, sub: string, color: string) {
  doc.roundedRect(x, y, w, h, 7).fill(color); doc.fillColor("#fff").font("Helvetica-Bold").fontSize(9.5).text(title, x + 6, y + 8, { width: w - 12, align: "center" });
  doc.font("Helvetica").fontSize(7.8).fillColor("#FFFFFFE6").text(sub, x + 6, y + 22, { width: w - 12, align: "center", lineGap: 1 });
}
function Arrow(x1: number, y1: number, x2: number, y2: number) {
  doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(1.4).strokeColor(GREY).stroke();
  const a = Math.atan2(y2 - y1, x2 - x1); doc.polygon([x2, y2], [x2 - 7 * Math.cos(a - 0.4), y2 - 7 * Math.sin(a - 0.4)], [x2 - 7 * Math.cos(a + 0.4), y2 - 7 * Math.sin(a + 0.4)]).fill(GREY);
}

// ================= COVER =================
doc.rect(0, 0, doc.page.width, doc.page.height).fill("#0F1F1A");
doc.rect(0, 0, 12, doc.page.height).fill(GREEN);
doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(11).text("ARSHITH GROUP", 70, 150, { characterSpacing: 3 });
doc.fillColor("#fff").fontSize(36).text("Finance ERP", 70, 175);
doc.font("Helvetica").fontSize(18).fillColor("#C8FAD6").text("How it works - the complete guide", 70, 226);
doc.moveTo(70, 270).lineTo(250, 270).lineWidth(3).strokeColor(GREEN).stroke();
doc.font("Helvetica").fontSize(11.5).fillColor("#DFE3E8").text("One system for three businesses:", 70, 292);
[["ArshithFresh", GREEN], ["ArshithInfotech", BLUE], ["Codelekho", PURPLE]].forEach(([n, c], i) => { doc.roundedRect(70, 322 + i * 38, 190, 28, 6).fill(c); doc.fillColor("#fff").font("Helvetica-Bold").fontSize(12).text(n, 84, 330 + i * 38); });
doc.font("Helvetica").fontSize(10).fillColor("#919EAB").text("Multi-company accounting  |  Double-entry ledger  |  GST aware  |  Role based  |  Fully audited", 70, 470, { width: 440 });
doc.fillColor("#637381").fontSize(9).text("Version 1.0  -  Built on the Dasher UI reference  -  Next.js 15, PostgreSQL 16", 70, 760);

// ================= 1. SUMMARY =================
H1("1. What you received", "A real, database-connected finance system - not a dashboard mock-up");
P("This is a working multi-company financial management ERP for ArshithFresh, ArshithInfotech and Codelekho. Every number you see on the dashboard, reports and exports is calculated on the server from a double-entry ledger stored in PostgreSQL. Nothing on screen is hard-coded.");
H2("The nine questions the Super Admin can answer in seconds");
Table(["Question", "Where to look", "How it is calculated"], [
  ["How much money came in?", "Dashboard > Total Revenue, Cash Flow chart", "Net revenue + other income from ledger income accounts (invoice revenue counted once, at invoice date)"],
  ["How much went out?", "Dashboard > Total Expenses", "Direct costs + operating expenses from ledger expense accounts"],
  ["How much is available?", "Dashboard > Available Cash / Bank Balance, Cash & Bank page", "Sum of cash and bank ledger accounts"],
  ["Profit of each company?", "Dashboard company charts, Reports > Company Comparison", "Income minus expenses per company_id"],
  ["Who owes us?", "Receivables & Invoices", "Accounts Receivable ledger = sum of unpaid invoice balances"],
  ["Whom do we owe?", "Payables & Bills", "Accounts Payable ledger = sum of unpaid bill balances"],
  ["Which company spends more?", "Dashboard > Company-wise comparison", "Expenses per company in the selected period"],
  ["Monthly / annual results?", "Reports > Monthly Summary, Annual Summary, P&L by month/quarter/year", "Ledger grouped by month and Indian financial year (Apr-Mar)"],
  ["Complete consolidated position?", "Reports > Balance Sheet (All Companies)", "Assets = Liabilities + Equity, proven on screen with a green check"],
], [2.2, 3, 4.2]);
H2("Modules delivered");
B(["Dashboard with 8 KPI cards, 6 charts, date filters, company switcher, dark mode, alerts bell.",
  "Income, Expenses (with approval workflow, recurring, GST, TDS, receipts upload), Refunds.",
  "Receivables and Invoices (auto numbering per company, GST invoice PDF, partial payments, overdue status).",
  "Payables and Bills (vendor bills, partial payments, TDS, due-date alerts).",
  "Cash and Bank (multiple accounts, transfers, capital/loan, opening balance adjustments, reconciliation).",
  "Reports (15 reports, Excel / CSV / PDF export that matches the on-screen filters).",
  "Budgets with warnings, GST and TDS tracking, Payroll with payslip PDFs, Customers and Vendors.",
  "Users, roles, company-level permissions, sessions, forgot-password, append-only audit log, backups."]);
H2("Proof it works (automated tests run against the real database)");
Table(["Suite", "Command", "Result"], [
  ["Accounting integrity (ledger, statements, scenarios, isolation)", "npm run verify", "68 / 68 passed"],
  ["HTTP end-to-end (auth, roles, approval, exports, uploads, periods, backup)", "npm run e2e", "74 / 74 passed (production mode)"],
  ["TypeScript strict type-check", "npm run typecheck", "0 errors"],
  ["Production build (type-check + lint)", "npm run build", "Success, 21 routes"],
], [4.5, 2, 2.6]);

// ================= 2. ARCHITECTURE =================
H1("2. Architecture - the big picture", "Four layers, one source of truth");
{
  const y0 = doc.y + 6, bw = 150, bh = 54;
  Box(48, y0, bw, bh, "Browser (React)", "Dasher theme - Bootstrap 5\nApexCharts, dark / light", BLUE);
  Box(48 + 175, y0, bw, bh, "Next.js 15 app", "Pages + one REST router\n/api/[...path]", GREEN);
  Box(48 + 350, y0, bw - 10, bh, "Services (server)", "txn, docs, misc, ledger,\nreports, export", PURPLE);
  Arrow(48 + bw, y0 + 27, 48 + 175, y0 + 27); Arrow(48 + 175 + bw, y0 + 27, 48 + 350, y0 + 27);
  const y1 = y0 + 105;
  Box(48 + 80, y1, 330, 66, "PostgreSQL 16", "journal_entries + journal_entry_lines = the ledger\nconstraints, triggers, row level security (RLS)", "#0F1F1A");
  Arrow(48 + 425, y0 + bh, 48 + 345, y1 + 5);
  doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text("Every request: cookie session -> role + company check in the API -> SET LOCAL ROLE erp_app + company ids -> RLS filters rows in the database.", 48, y1 + 80, { width: W() });
  doc.y = y1 + 108;
}
H2("Why this design");
B(["One ledger, many views. Dashboard, P&L, balance sheet, cash flow, tax summary and exports all read the same posted journal lines, so they can never disagree.",
  "Calculations happen on the server in whole paise (integers) and are stored as numeric(18,2). The browser only displays; it never decides an amount.",
  "Three independent protection layers for company data: (1) API checks, (2) service checks, (3) PostgreSQL row level security. Even a bug in the app cannot read another company's rows for a restricted user.",
  "Existing infrastructure was not touched. Your exam platform stays as is; this ERP lives in its own folder with its own database."]);
H2("Technology choices");
Table(["Layer", "Used", "Why"], [
  ["Frontend", "Next.js 15, React 19, TypeScript, Dasher (Bootstrap 5 + SCSS) theme", "Your reference UI was Dasher, so the layout, colours, cards and sidebar are the same"],
  ["Charts", "ApexCharts", "Same chart library as the reference theme (the brief suggested Recharts; Apex keeps the look identical)"],
  ["API", "Next.js route handlers with a small custom router", "Single place for auth, CSRF origin check, permission checks, error mapping"],
  ["Database", "PostgreSQL (local on port 5434)", "Decimal money, constraints, triggers and RLS"],
  ["Auth", "Own session table + bcrypt, HttpOnly cookie", "Supabase credentials were not available. See section 11 for how to move to Supabase Auth"],
  ["Exports", "ExcelJS (xlsx), PDFKit (pdf), CSV", "Server side so exports use the same filters and data as the screen"],
], [1.3, 3.2, 4.6]);

// ================= 3. ACCOUNTING =================
H1("3. The accounting engine", "Double entry - every rupee is recorded twice, and the two sides must match");
P("Double-entry means each business event creates a journal entry with debit lines and credit lines whose totals are equal. The system enforces this in two places: the service refuses to post an unbalanced entry, and a PostgreSQL deferred constraint trigger rejects it at commit time even if someone bypasses the app.");
H2("What gets posted for each business event");
Table(["Event", "Debit", "Credit", "Notes"], [
  ["Income received (cash / bank / UPI)", "Bank or Cash (total)", "Revenue account (base) + Output GST", "Pending income stays as a draft, outside the books"],
  ["Expense paid", "Expense account (base) + Input GST", "Bank or Cash (total minus TDS) + TDS payable", "Equipment / Inventory categories map to asset accounts (capitalised)"],
  ["Invoice issued", "Accounts Receivable (total) + Sales Discounts", "Revenue (gross) + Output CGST/SGST/IGST", "Revenue recorded here, once"],
  ["Receipt against invoice", "Bank or Cash", "Accounts Receivable", "Partial payments allowed. No new revenue"],
  ["Vendor bill posted", "Expense accounts + Input GST", "Accounts Payable + TDS payable", "Expense recognised on bill date"],
  ["Payment against bill", "Accounts Payable", "Bank or Cash", "Partial payments allowed"],
  ["Transfer between own accounts", "Destination account", "Source account", "Never touches income or expense"],
  ["Customer refund", "Sales Returns + Output GST", "Bank or Cash", "Reduces net revenue"],
  ["Owner capital / drawings", "Bank / Capital", "Capital / Bank", "Equity only, no profit effect"],
  ["Loan received / repaid", "Bank / Loan", "Loan / Bank", "Liability only, no profit effect"],
  ["Payroll posted", "Salaries and Wages (gross)", "Salary Payable (net) + TDS & statutory + Advance recovery", "Paid later: Dr Salary Payable, Cr Bank"],
  ["GST payment / ITC set-off", "Output GST accounts", "Bank / Input GST accounts", "Reduces liability, not an expense"],
  ["Opening balance (and adjustments)", "Bank account", "Opening Balance Equity", "Adjustments post only the difference, with a reason"],
], [2.2, 2.2, 2.7, 2.6], { size: 8 });
H2("Rules that stop wrong numbers");
B(["No double counting: an invoice is revenue; its payments only move Receivable to Bank. The tests prove that a partial payment leaves revenue unchanged.",
  "Posted records are immutable. Database triggers block UPDATE or DELETE on posted journal lines and on posted transactions, invoices, bills and payments.",
  "Void = reversal. Voiding posts an exact mirror entry on the original date, marks the original as reversed, and keeps both visible with who / when / why.",
  "Editing a posted entry reverses it and posts a fresh one (old and new values both stay in the audit log).",
  "Statuses: draft -> pending approval -> posted -> voided. Expenses entered by non-super-admins wait for approval and do not touch profit until approved.",
  "Closed financial periods reject any entry dated inside them (trigger), so reported years stay frozen.",
  "Cash in hand cannot go negative. Bank accounts may overdraw.",
  "Row locks (SELECT ... FOR UPDATE) protect invoices, bills and payments against two people paying the same balance at once."]);

// ================= 4. REPORTS =================
H1("4. How the reports are built", "All from the ledger, all exportable");
H2("Profit & Loss");
Code("Gross Revenue      = credit - debit on 'revenue' accounts\nNet Revenue        = Gross Revenue - Discounts - Sales Returns\nGross Profit       = Net Revenue - Direct Costs (COGS, gateway fees, project costs)\nOperating Profit   = Gross Profit - Operating Expenses\nNet Profit         = Operating Profit + Other Income  (= Total Income - Total Expenses)");
P("Account classification is configurable: every ledger account has a classification (revenue, other income, discount, sales return, direct cost, operating expense, ...). A new category you create is mapped to an account and automatically lands in the right P&L line. View by company (with consolidated total), month, quarter or financial year.");
H2("Balance Sheet");
Code("Assets      = Cash + Bank + Receivable + Inventory + Equipment + Input GST / other\nLiabilities = Payable + Loans + Outstanding expenses + GST/TDS + Salary payable + other\nEquity      = Capital + Opening-balance equity\n            + Retained earnings (profit of all earlier financial years)\n            + Current-year profit / loss\nCheck:  Assets = Liabilities + Equity   (shown as a green badge; difference shown in red if ever wrong)");
H2("Cash Flow (direct method, derived from the ledger)");
P("For every journal entry that touches a cash or bank account, the other (non-cash) lines tell us why cash moved. They are classified as Operating (customers, suppliers, expenses, salaries, GST/TDS), Investing (equipment / fixed assets) or Financing (capital, drawings, loans). Entries that only move money between two own accounts have no non-cash side, so they are excluded automatically. Closing cash is checked against the ledger balance of cash + bank accounts.");
H2("Dashboard numbers");
B(["Each KPI compares the selected period with the previous period of the same length and shows the percentage change.",
  "Monthly Growth compares revenue of the latest month with the month before it.",
  "Future months are never shown as zeros; ranges that end after today are cut at today.",
  "Charts: Revenue vs Expenses, Monthly Profit Trend, Cash Flow (operating / investing / financing), Revenue by company, Company profit comparison, Expense category breakdown."]);
H2("All 15 reports");
Table(["Report", "Filters", "Notes"], [
  ["Profit & Loss", "Company, date range, group (company / month / quarter / year)", "Consolidated total column"],
  ["Balance Sheet", "Company, as-of date", "Equation check"],
  ["Cash Flow", "Company, date range", "Opening, inflow, outflow, net, closing"],
  ["Trial Balance", "Company, as-of date", "Debit total = credit total"],
  ["Income / Expense report", "Company, date range, category", "Ledger lines, net of discounts / returns"],
  ["Receivables / Payables", "Company, status", "Aging with days overdue"],
  ["Tax (GST and TDS)", "Company, date range", "Output, input credit, net payable, paid, TDS"],
  ["Payroll", "Company, date range", "Restricted to payroll roles"],
  ["Budget vs Actual", "Company, financial year", "Utilisation and warnings"],
  ["Company Comparison", "Date range", "Revenue, expenses, profit, margin, cash, AR, AP"],
  ["Product / Project / Course", "Company, date range", "Uses the tag on income, expenses, invoices"],
  ["Monthly / Annual Summary", "Company, range", "Opening cash, in, out, closing cash"],
], [2.3, 3.8, 3]);
P("Excel, CSV and PDF exports call the same server function as the screen, with the same company, date and category filters. The tests open every exported Excel file and confirm the row count equals the on-screen row count.");

// ================= 5. MODULES =================
H1("5. Module walkthrough", "What each screen does and what happens behind it");
H2("Company switcher and date filter");
P("The switcher in the header holds All Companies, ArshithFresh, ArshithInfotech and Codelekho. It is remembered in the browser and sent with every request. Users only see the companies they are assigned to; a company admin who has one company will never see 'All'. The date filter offers Today, This Week, This Month, Last Month, This Quarter, This Financial Year (April-March) and a Custom Range.");
H2("Income");
B(["Add / edit / void with company, category, customer, invoice number, date, payment method, reference, base amount, GST, project tag, status and receipt upload.",
  "Categories are configurable in Settings. UPI, bank transfer and cash are payment methods (you pick them in the Method field) rather than categories, so reports stay clean.",
  "Payment status 'Pending' keeps the record as a draft outside the books until you mark it received.",
  "Search, filters (category, status, method), pagination, Excel / PDF / CSV export, per-record history."]);
H2("Expenses");
B(["Same screen style with vendor, GST (input credit), TDS deducted, recurring (monthly / quarterly / yearly) and approval.",
  "Super Admin posts directly. Everyone else creates 'pending approval' items. Pending, approved and rejected actions are logged.",
  "Recurring expenses: press 'Run recurring' to create every due occurrence since the last run.",
  "Cards show total, GST, awaiting approval and the highest category; charts show the monthly trend and category split."]);
H2("Receivables, invoices and bills");
B(["Invoice lines: description, HSN/SAC, category, quantity, rate, discount, GST %. Totals are recomputed by the server.",
  "GST type is decided from the customer's state code vs the company's: same state -> CGST + SGST, different -> IGST.",
  "Numbers are separate per company and restart each financial year: AFR/INV/2026-27/0001, AIT/INV/..., CLK/INV/.... Draft invoices get their number only when issued, so the sequence has no gaps.",
  "Statuses: Paid, Partially Paid, Unpaid, Overdue (computed from due date and payments). Overdue invoices raise alerts in the bell and dashboard.",
  "PDF invoice: company logo block, GSTIN, address, customer, items, tax split, amount in words, payment history, terms, bank details. Print / download / share by email, WhatsApp or link.",
  "Bills mirror this for suppliers, including TDS withheld and due-date reminders."]);
H2("Cash and Bank");
B(["Any number of cash, bank, UPI and wallet accounts per company. Only the last 4 digits of an account number are ever stored.",
  "Transfers, owner capital, drawings, loan received and loan repayment. Transfers are internal and never counted as income or expense.",
  "Opening balance adjustments post an adjusting entry with a mandatory reason and are audit-logged.",
  "Bank reconciliation: enter the statement date and closing balance, tick the lines that cleared, and watch the difference reach zero. Reconciled lines are locked into the reconciliation record."]);
H2("Budgets, Tax, Payroll");
B(["Budgets per company, category, department, month or full year. Utilisation bars turn amber at 90 percent and red above 100 percent, with alerts on the dashboard and in the bell.",
  "GST: summary of output GST, input credit and net payable by CGST / SGST / IGST, payment records (challan), ITC set-off, TDS deposits, accountant 'verified' stamp. It does not file returns - see section 11.",
  "Payroll (restricted): employees, monthly run, editable draft, post to ledger, pay, advances, PDF payslips."]);

// ================= 6. SECURITY =================
H1("6. Users, roles and security", "Never expose one company's data to someone who should not see it");
Table(["Capability", "Super Admin", "Company Admin", "Accountant", "Viewer"], [
  ["See consolidated / all companies", "Yes", "Own companies only", "Assigned companies", "Assigned companies"],
  ["Create and edit transactions, invoices, bills", "Yes", "Yes", "Yes", "No"],
  ["Approve expenses", "Yes", "No", "No", "No"],
  ["Bank reconciliation", "Yes", "Yes", "Yes", "No"],
  ["Payroll", "Yes", "Yes", "No", "No"],
  ["Budgets, GST and tax records", "Yes", "Yes", "Yes", "No"],
  ["Audit log", "Yes", "Yes (own companies)", "No", "No"],
  ["Users, companies, settings, backups, period close", "Yes", "No", "No", "No"],
], [3.2, 1.3, 1.7, 1.5, 1.5], { size: 8.4 });
H2("Security measures");
B(["Passwords hashed with bcrypt (cost 11). Minimum 10 characters with upper case, lower case and a digit. 5 wrong attempts lock the account for 15 minutes.",
  "Session cookie is HttpOnly, SameSite=Lax (Secure in production). Sessions expire in 12 hours, can be listed and revoked, and are revoked on password change or deactivation.",
  "CSRF: state-changing requests with a foreign Origin header are refused.",
  "SQL injection: every query is parameterised. Search text is escaped for LIKE.",
  "Input validation on every service (amounts, dates, ranges, ownership of referenced records). Database CHECK constraints are the last line of defence.",
  "Uploads: PDF / PNG / JPG / WebP only, 5 MB maximum, type verified from the file bytes (not the filename), stored outside the public folder with a random name, served with nosniff.",
  "No secrets in the browser. The database URL and session secret live in .env.local on the server.",
  "Forgot password never reveals whether an email exists, and the token is single-use for 30 minutes. In production the token is only written to the server log until SMTP is configured.",
  "CSV exports neutralise spreadsheet formula injection."]);
H2("Audit log");
P("Every create, update, approve, reject, void, issue, post, payment, export, login, failed login, opening-balance adjustment, period close and backup is written to an append-only table (updates and deletes are blocked by a trigger). Each row stores who, when, IP, the previous values and the new values. The Audit Log page filters by company, record type, action, date and free text.");
H2("Company isolation in the database");
Code("-- each data query runs as a low-privilege role with the caller's companies\nSET LOCAL ROLE erp_app;\nSELECT set_config('app.company_ids', '2,3', true);   -- or app.is_super = '1'\n-- every company table has:  USING (app_company_ok(company_id))\n-- so a Company Admin of ArshithFresh gets 0 rows from ArshithInfotech even with raw SQL.");

// ================= 7. DATABASE =================
H1("7. Database", "Relational, constrained, auditable");
Table(["Table", "Purpose"], [
  ["companies, company_memberships, user_profiles, sessions", "The three businesses, who belongs where, logins and active sessions"],
  ["accounts, account_categories", "Chart of accounts per company; configurable income / expense categories mapped to accounts"],
  ["journal_entries, journal_entry_lines", "THE LEDGER. Immutable, balanced, source-linked. All reports read from here"],
  ["transactions", "Income, expense, refund, transfer, capital, drawing, loan records with status and approval trail"],
  ["invoices, invoice_items, bills, bill_items, payments", "Receivables and payables with partial payments"],
  ["bank_accounts, bank_reconciliations, reconciled_lines", "Cash / bank accounts and reconciliation history"],
  ["customers, vendors, employees, employee_advances", "Master data per company"],
  ["budgets, tax_records, payroll, payroll_items", "Budgeting, GST / TDS records, monthly payroll"],
  ["attachments", "Receipt / proof metadata (hash, size, type); files on disk"],
  ["audit_logs", "Append-only change history"],
  ["financial_periods, doc_sequences", "Open / closed FY periods; per-company document numbering"],
], [3.4, 5.6], { size: 8.4 });
H2("Constraints and triggers worth knowing");
B(["Every financial row carries company_id with a foreign key and an index. Money is numeric(18,2). Debit and credit CHECKs: never negative, exactly one is zero.",
  "trg_entry_balanced (deferred): total debit must equal total credit for each journal entry at commit.",
  "trg_je_immutable / trg_jel_immutable / trg_audit_immutable: no update or delete of posted ledger rows or audit rows (only the 'reversed' flag may change).",
  "trg_nodel_*: posted transactions, invoices, bills, payments, tax records cannot be deleted.",
  "trg_period_open: blocks postings dated inside a closed financial period.",
  "Row level security on all company tables, plus a read-only view of user names for joins."]);
H2("Files in the project");
Code("arshith-erp/\n  db/migrations/001_init.sql      schema, triggers, RLS\n  lib/ledger.ts                   post() and reverse() - the only way to write the ledger\n  lib/txn.ts, docs.ts, misc.ts    income/expense, invoices/bills/payments, bank/payroll/tax\n  lib/reports.ts, export.ts       statements, dashboard, Excel/CSV/PDF\n  lib/api.ts                      REST router, auth, CSRF, errors\n  app/(dashboard)/*               pages        components/erp/*  shared UI\n  scripts/                        migrate, seed, verify, e2e, make-guide");

// ================= 8. COMPANY FEATURES =================
H1("8. Company-specific needs", "Configurable, nothing forced");
Table(["Company", "What you asked for", "How it is covered"], [
  ["ArshithFresh", "Sales, purchases, inventory expenses, supplier payments, customer receivables, product-wise revenue", "Income + invoices (Product Sales), vendor bills (Purchases), Inventory category mapped to the Inventory asset account, Payables, Receivables, product tag + 'Product / Project / Course' report"],
  ["ArshithInfotech", "Project revenue, client invoices, project expenses, salaries, service income, client payment tracking", "Software Project Revenue / Service Income categories, GST invoices with project reference, Project Direct Costs category, payroll, receivable aging per client"],
  ["Codelekho", "Course sales, student payments, subscriptions, course-wise income, refunds, marketing, gateway charges", "Course Sales / Subscription Income categories, Refund entries (reduce net revenue), Payment Gateway Charges as direct cost, course tag + report"],
], [1.4, 3.5, 4.5], { size: 8.4 });
P("Not every business needs every transaction type: all modules are generic and optional, categories are per company and can be switched on / off, and the Product / Project / Course tag gives product-wise, project-wise or course-wise numbers without changing the structure. The 'business focus' tags in Settings are informational only.");

// ================= 9. HOW TO RUN =================
H1("9. Running it", "Local setup, demo logins and operations");
H2("Start (Windows, from D:\\exam\\arshith-erp)");
Code("# 1. database (already created on port 5434)\npg_ctl -D .pgdata -o \"-p 5434\" start\n\n# 2. create tables + demo data (safe to re-run; seed skips if data exists)\nnpm run db:migrate\nnpm run db:seed          # or: npm run db:reset  (drops everything and re-seeds)\n\n# 3. run\nnpm run dev              # http://localhost:3100  (use -p 3100)\n# production:  npm run build  then  npm run start -- -p 3100\n\n# 4. tests\nnpm run verify           # accounting integrity (68 checks)\nnpm run e2e              # HTTP end-to-end (needs the server running)");
H2("Demo logins (created by the seed)");
Table(["Role", "Email", "Password", "Companies"], [
  ["Super Admin", "admin@arshith.test", "Admin@12345", "All"],
  ["Company Admin", "fresh.admin@arshith.test", "Demo@12345", "ArshithFresh"],
  ["Accountant", "accountant@arshith.test", "Demo@12345", "ArshithInfotech, Codelekho"],
  ["Viewer", "viewer@arshith.test", "Demo@12345", "ArshithInfotech"],
], [1.6, 3, 1.8, 2.8]);
Note("Change these passwords and the SESSION_SECRET in .env.local before going live. Company details (GSTIN, address, bank details) in the seed are SAMPLE values - edit them in Settings > Company profile.", RED);
H2("Demo data");
P("The seed uses the real application services to create about a year of activity for all three companies (income, invoices with partial payments, bills, expenses, transfers, refunds, payroll, budgets, one GST payment). This means the demo ledger is genuinely balanced, and you can delete the database and start clean with your own data by creating a fresh schema and skipping the seed.");
H2("Backups");
P("Settings > Backups runs pg_dump (custom format) into storage/backups. For production schedule the same command daily with Windows Task Scheduler and copy the files off the machine. Restore with pg_restore.");
Code("pg_dump -Fc -f backup.dump postgresql://postgres@localhost:5434/erp\npg_restore -d erp_restored backup.dump");

// ================= 10. TESTING =================
H1("10. What was tested", "Your section 22 checklist, mapped to evidence");
Table(["Your test case", "Result", "How it was checked"], [
  ["1. Create all three companies", "Pass", "Seed creates them; Settings can add more"],
  ["2. Transactions for each company", "Pass", "About 2,500 ledger lines across the three companies"],
  ["3. Company data isolation", "Pass", "Raw SQL as company admin returns 0 rows of other companies; API returns 403; cross-company insert blocked by RLS"],
  ["4. Consolidated dashboard", "Pass", "Consolidated net profit equals the sum of the three companies; dashboard equals Company Comparison"],
  ["5. Income updates revenue", "Pass", "Rs 1,00,000 income + GST raises profit by exactly Rs 1,00,000"],
  ["6. Expenses update profit", "Pass", "Expense lowers profit by base amount only; approval workflow tested over HTTP"],
  ["7. Invoice + partial payment", "Pass", "Total with discount and 18% GST verified; revenue not doubled by the payment"],
  ["8. Outstanding receivables", "Pass", "Receivable report total equals Accounts Receivable ledger"],
  ["9. Supplier bill + payment", "Pass", "5% GST bill, partial payment leaves the right balance"],
  ["10. Outstanding payables", "Pass", "Payable report total equals Accounts Payable ledger"],
  ["11. Bank transfer vs revenue", "Pass", "Profit unchanged by a transfer"],
  ["12. Monthly and yearly reports", "Pass", "Run for every period type"],
  ["13. Excel and PDF exports", "Pass", "All 15 reports exported to xlsx and pdf; row counts match the screen"],
  ["14. Role permissions", "Pass", "Viewer, accountant, company admin and super admin matrix tested over HTTP"],
  ["15. Audit logs", "Pass", "create -> approve -> void history, append-only enforced"],
  ["16. Balance sheet equation", "Pass", "For All, and for each company, before and after test postings"],
  ["17. Debit = credit", "Pass", "Whole ledger, per entry, per company; unbalanced commit rejected"],
  ["18. Mobile responsiveness", "Pass", "Checked at 375 px width: no horizontal page scroll on the main pages; sidebar becomes a drawer"],
], [2.6, 0.8, 5.6], { size: 8.2 });
H2("Also verified");
B(["Account lock-out after repeated failures, password reset token single-use, weak passwords rejected.",
  "CSRF origin block, upload type spoofing blocked, oversize files rejected, filenames sanitised.",
  "Closing a financial period blocks posting; reopening allows it again.",
  "Database backup creation. Production build has no TypeScript errors."]);

// ================= 11. LIMITS =================
H1("11. Honest limits and what needs your input", "Things that are intentionally not faked");
Note("This section matters. Please read it before relying on the system for statutory work.", RED);
Table(["Item", "Status", "What you need to do"], [
  ["GST return filing / GST portal", "NOT integrated", "The system computes GST positions and keeps payment records. Your accountant must verify and file returns. Real integration needs an authorised GSP / API account."],
  ["E-invoice (IRN) and e-way bill", "Not included", "Needs government / GSP credentials."],
  ["Email (password reset, invoice sending)", "Not configured", "Needs SMTP credentials. Today the reset link is written to the server log (and returned in development only). Invoice sharing uses mailto / WhatsApp links."],
  ["Supabase (Auth, Storage, hosted Postgres)", "Not used", "No Supabase project / keys were provided. Auth, files and database are self-hosted. The data layer is plain PostgreSQL, so moving to Supabase Postgres is straightforward; swapping the login to Supabase Auth would replace lib/auth.ts."],
  ["Bank statement import / bank feeds", "Not included", "Reconciliation is manual tick-and-match. CSV import or a bank API can be added later."],
  ["Inventory quantities / stock valuation", "Not included", "Inventory purchases are capitalised to the Inventory asset account; there is no per-item stock ledger or COGS by weight."],
  ["Multi-currency", "Not included", "All amounts are INR."],
  ["Payroll statutory calculations (PF, ESI, PT, TDS slabs)", "Not automatic", "Deductions are entered per employee. Statutory rates are not computed."],
  ["Hosted deployment", "Not done", "Runs locally. For the internet you need a server, HTTPS, a production secret, and scheduled backups."],
  ["Live data", "Demo data", "Seeded companies use SAMPLE GSTIN / address. Replace in Settings."],
], [2.3, 1.3, 5.4], { size: 8.4 });
H2("Design decisions you may want to change");
B(["Expense categories Equipment and Inventory are treated as assets (capitalised), so they do not appear in P&L expenses. If you prefer to expense them, remap the category to an expense account in Settings.",
  "Only expenses go through approval. Income, invoices and bank movements post immediately for users who may write.",
  "The system stores base amount and GST separately (Amount excl. GST + GST amount), so GST is never counted as revenue or expense.",
  "Voiding is the only way to remove a posted record, by design."]);
H2("Suggested next steps");
B(["Replace sample company details; create your real users; change all passwords and the session secret.",
  "Decide on hosting; set up HTTPS, SMTP and daily backups.",
  "Ask your accountant to review the chart of accounts and category mapping once, then lock the first financial year when you are satisfied.",
  "Optional upgrades: bank CSV import, stock quantities, statutory payroll, e-invoicing via a GSP."]);

// page numbers (skip cover)
const range = doc.bufferedPageRange();
for (let i = 1; i < range.count; i++) {
  doc.switchToPage(i);
  doc.page.margins.bottom = 0;
  doc.font("Helvetica").fontSize(8).fillColor("#919EAB").text(`Arshith Group Finance ERP - How it works  |  Page ${i + 1} of ${range.count}`, 48, doc.page.height - 34, { width: W(), align: "center", lineBreak: false });
}
doc.end();
doc.on("end", () => console.log("written", OUT));
