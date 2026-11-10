// Seeds 3 companies, users, chart of accounts and ~12 months of realistic activity THROUGH THE SAME SERVICES the app uses,
// so the demo ledger is genuinely double-entry and balanced.
import bcrypt from "bcryptjs";
import { sys, tx, pool, q1, SessionUser } from "../lib/db";
import { onboardCompany } from "../lib/setup";
import { createTxn } from "../lib/txn";
import { saveInvoice, recordPayment, saveBill } from "../lib/docs";
import { createBankAccount, createPayroll, postPayroll, payPayroll, createTaxRecord } from "../lib/misc";
import { addDays, addMonths, monthEnd } from "../lib/core";

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const TODAY = "2026-11-10";
const cap = (d: string) => (d > TODAY ? TODAY : d);

async function main() {
  const existing = await sys((c) => q1(c, "SELECT count(*)::int n FROM companies"));
  if (existing!.n > 0) { console.log("database already seeded"); await pool.end(); return; }

  const defs = [
    { code: "AFR", name: "ArshithFresh", legal: "Arshith Fresh Foods", type: "Fresh produce & grocery trading", gst: "36AAAPA0001A1Z5", pan: "AAAPA0001A", color: "#16a34a", features: { inventory: true, productRevenue: true } },
    { code: "AIT", name: "ArshithInfotech", legal: "Arshith Infotech Services", type: "Software development & IT services", gst: "36AAAPA0002B1Z3", pan: "AAAPA0002B", color: "#2563eb", features: { projects: true, payroll: true } },
    { code: "CLK", name: "Codelekho", legal: "Codelekho Learning Pvt Ltd", type: "Education & online learning platform", gst: "36AAAPA0003C1Z1", pan: "AAAPA0003C", color: "#9333ea", features: { courses: true, subscriptions: true, refunds: true } },
  ];
  const pw = await bcrypt.hash("Demo@12345", 11), apw = await bcrypt.hash("Admin@12345", 11);
  const ids: number[] = [];
  await sys(async (c) => {
    for (const d of defs) {
      const co = await q1(c, `INSERT INTO companies(code,name,legal_name,business_type,gstin,pan,address,city,state,state_code,pincode,phone,email,logo_text,brand_color,invoice_prefix,bill_prefix,bank_details,features)
        VALUES ($1,$2,$3,$4,$5,$6,'Sample address (edit in Settings)','Hyderabad','Telangana','36','500001','+91 90000 00000',$7,$8,$9,$10,$11,'Edit bank details in Settings',$12) RETURNING id`,
        [d.code, d.name, d.legal, d.type, d.gst, d.pan, `accounts@${d.name.toLowerCase()}.test`, d.name.slice(0, 2).toUpperCase(), d.color, `${d.code}/INV`, `${d.code}/BILL`, JSON.stringify(d.features)]);
      ids.push(co!.id);
      await onboardCompany(c, co!);
    }
    const mk = async (email: string, name: string, role: string, hash: string, cos: number[]) => {
      const u = await q1(c, "INSERT INTO user_profiles(email,name,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id", [email, name, hash, role]);
      for (const co of cos) await c.query("INSERT INTO company_memberships VALUES ($1,$2)", [u!.id, co]);
    };
    await mk("admin@arshith.test", "Group Super Admin", "SUPER_ADMIN", apw, []);
    await mk("fresh.admin@arshith.test", "Fresh Company Admin", "COMPANY_ADMIN", pw, [ids[0]]);
    await mk("accountant@arshith.test", "Group Accountant", "ACCOUNTANT", pw, [ids[1], ids[2]]);
    await mk("viewer@arshith.test", "Infotech Viewer", "VIEWER", pw, [ids[1]]);
  });

  const SU: SessionUser = { id: (await sys((c) => q1(c, "SELECT id FROM user_profiles WHERE role='SUPER_ADMIN'")))!.id, email: "admin@arshith.test", name: "Seeder", role: "SUPER_ADMIN", companyIds: ids };
  const start = "2025-11-01";
  const months: string[] = [];
  for (let m = start; m <= "2026-11-01"; m = addMonths(m, 1)) months.push(m);

  await tx(SU, async (c) => {
    for (let ci = 0; ci < 3; ci++) {
      const co = ids[ci];
      const cat = async (kind: string, name: string) => (await q1(c, "SELECT id FROM account_categories WHERE company_id=$1 AND kind=$2 AND name=$3", [co, kind, name]))!.id;
      const cash = await createBankAccount(c, SU, { company_id: co, name: "Cash in Hand", account_type: "cash", opening_balance: 50000, opening_date: start });
      const bank = await createBankAccount(c, SU, { company_id: co, name: "Primary Current Account", bank_name: "HDFC Bank", account_type: "bank", account_ref: "0000123456781234", opening_balance: [1500000, 2500000, 2500000][ci], opening_date: start });
      const upi = await createBankAccount(c, SU, { company_id: co, name: "UPI / Gateway Settlement", bank_name: "ICICI Bank", account_type: "upi", account_ref: "9988", opening_balance: 500000, opening_date: start });
      await createTxn(c, SU, { company_id: co, kind: "capital", txn_date: start, base_amount: [500000, 1000000, 2000000][ci], bank_account_id: bank.id, description: "Owner capital introduced" });

      const customers: any[] = [], vendors: any[] = [], emps: any[] = [];
      const cn = [["Green Basket Retail", "Metro Mart", "Fresh Hotels Group", "Sri Sai Stores", "Annapurna Caterers"], ["Nimbus Logistics", "BrightPath Edu", "Orbit Healthcare", "Kaveri Finserv", "Zenith Retail Tech"], ["Individual Learners", "TechBridge Academy", "Corporate Cohort Batch", "Campus Connect", "Skill India Partner"]][ci];
      for (const n of cn) customers.push(await q1(c, "INSERT INTO customers(company_id,name,email,phone,state_code,credit_days) VALUES ($1,$2,$3,'+91 98000 00000',$4,$5) RETURNING *", [co, n, n.toLowerCase().replace(/[^a-z]/g, "") + "@client.test", pick(["36", "36", "29", "27"]), pick([15, 30])]));
      const vn = [["Farm Direct Growers", "Cold Chain Transport", "PackWell Industries"], ["Cloud Hosting Pvt Ltd", "DevTools Licensing", "WorkSpace Rentals"], ["Video Editing Studio", "Payment Gateway Co", "Ad Network Services"]][ci];
      for (const n of vn) vendors.push(await q1(c, "INSERT INTO vendors(company_id,name,email,state_code,credit_days) VALUES ($1,$2,$3,'36',30) RETURNING *", [co, n, n.toLowerCase().replace(/[^a-z]/g, "") + "@vendor.test"]));
      const staff: [string, string, number][][] = [
        [["Ravi Kumar", "Warehouse Lead", 24000], ["Sita Devi", "Accounts Executive", 28000], ["Anil Reddy", "Delivery Executive", 18000]],
        [["Karthik S", "Senior Developer", 85000], ["Meena R", "UI/UX Designer", 62000], ["Pranav D", "QA Engineer", 48000], ["Divya T", "Project Manager", 95000]],
        [["Lakshmi N", "Content Lead", 55000], ["Harsha V", "Instructor", 70000], ["Sneha P", "Support Executive", 30000]],
      ];
      let k = 1;
      for (const [n, d, b] of staff[ci])
        emps.push(await q1(c, "INSERT INTO employees(company_id,emp_code,name,designation,department,join_date,basic,allowances,deductions) VALUES ($1,$2,$3,$4,'Operations','2024-04-01',$5,$6,$7) RETURNING *", [co, `E${String(k++).padStart(3, "0")}`, n, d, b, Math.round(b * 0.2), Math.round(b * 0.12)]));

      const incomeCats = [["Product Sales", "Cash Income"], ["Software Project Revenue", "Service Income"], ["Course Sales", "Subscription Income"]][ci];
      const projects = [["Fresh Vegetables", "Fruits", "Dairy"], ["Project Alpha", "Project Nimbus", "AMC Support"], ["Full-Stack Bootcamp", "Data Analytics Course", "Python Basics"]][ci];
      for (const m of months) {
        const d = (day: number) => cap(`${m.slice(0, 7)}-${String(day).padStart(2, "0")}`);
        for (let n = 0; n < 4; n++) {
          const base = ci === 0 ? between(60000, 180000) : ci === 1 ? between(40000, 120000) : between(15000, 90000);
          await createTxn(c, SU, { company_id: co, kind: "income", txn_date: d(between(2, 27)), base_amount: base, tax_amount: Math.round(base * (ci === 0 ? 0.05 : 0.18)), category_id: await cat("income", pick(incomeCats)), bank_account_id: pick([bank.id, upi.id, cash.id]), customer_id: pick(customers).id, party_name: pick(cn), payment_method: pick(["UPI", "Bank transfer", "Cash", "Card"]), project: pick(projects), description: "Sales receipt" });
        }
        const ni = ci === 1 ? 3 : 2;
        for (let n = 0; n < ni; n++) {
          const cust = pick(customers);
          const price = ci === 1 ? between(80000, 250000) : between(20000, 90000);
          const inv = await saveInvoice(c, SU, { company_id: co, customer_id: cust.id, issue_date: d(between(3, 20)), project: pick(projects), post: true, items: [{ description: ["Product supply", "Software development milestone", "Course batch fee"][ci], category_id: await cat("income", incomeCats[0]), quantity: 1, unit_price: price, discount: rnd() < 0.3 ? Math.round(price * 0.05) : 0, gst_rate: ci === 0 ? 5 : 18 }] });
          const roll = rnd();
          if (m < "2026-10-01" && roll < 0.55) await recordPayment(c, SU, "receipt", inv.id, { bank_account_id: bank.id, amount: inv.total, pay_date: cap(addDays(inv.issue_date, between(5, 25))), method: "Bank transfer", reference: "NEFT" + between(100000, 999999) });
          else if (roll < 0.8 && m < "2026-11-01") await recordPayment(c, SU, "receipt", inv.id, { bank_account_id: bank.id, amount: Math.round(inv.total * 0.4), pay_date: d(28), method: "UPI", reference: "UTR" + between(100000, 999999) });
        }
        const vb = pick(vendors);
        const bill = await saveBill(c, SU, { company_id: co, vendor_id: vb.id, bill_date: d(between(2, 15)), vendor_bill_ref: "VB-" + between(1000, 9999), post: true, items: [{ description: ["Produce purchase", "Cloud & licences", "Video production"][ci], category_id: await cat("expense", ["Purchases", "Software Subscriptions", "Marketing"][ci]), quantity: 1, unit_price: ci === 0 ? between(80000, 200000) : between(15000, 60000), gst_rate: ci === 0 ? 5 : 18 }] });
        if (m < "2026-10-01" || rnd() < 0.4) await recordPayment(c, SU, "payment", bill.id, { bank_account_id: bank.id, amount: bill.total - bill.tds_amount - (rnd() < 0.2 ? Math.round(bill.total * 0.3) : 0), pay_date: d(25), method: "Bank transfer" });
        const ex = async (name: string, amt: number, taxRate: number, bk = bank.id) => createTxn(c, SU, { company_id: co, kind: "expense", txn_date: d(between(1, 26)), base_amount: amt, tax_amount: Math.round(amt * taxRate), category_id: await cat("expense", name), bank_account_id: bk, payment_method: "Bank transfer", description: name + " " + m.slice(0, 7) });
        await ex("Office Rent", [35000, 60000, 28000][ci], 0.18);
        await ex("Electricity", between(4000, 12000), 0);
        await ex("Internet", between(1500, 4000), 0.18);
        if (ci !== 0) await ex("Software Subscriptions", between(8000, 30000), 0.18);
        await ex("Marketing", between(10000, 55000), 0.18, ci === 2 ? upi.id : bank.id);
        if (ci === 2) await ex("Payment Gateway Charges", between(3000, 9000), 0.18, upi.id);
        if (ci === 0) await ex("Transportation", between(8000, 25000), 0.05);
        if (rnd() < 0.2) await ex("Professional Fees", between(10000, 30000), 0.18);
        if (ci === 2 && rnd() < 0.6) await createTxn(c, SU, { company_id: co, kind: "refund", txn_date: d(between(5, 25)), base_amount: between(1500, 8000), tax_amount: 0, bank_account_id: upi.id, party_name: "Student refund", description: "Course refund" });
        // internal transfers: must never be counted as income or expense
        await createTxn(c, SU, { company_id: co, kind: "transfer", txn_date: d(28), base_amount: between(20000, 60000), bank_account_id: upi.id, to_bank_account_id: bank.id, description: "Settlement sweep" });
        await createTxn(c, SU, { company_id: co, kind: "transfer", txn_date: d(12), base_amount: 15000, bank_account_id: bank.id, to_bank_account_id: cash.id, description: "Cash withdrawal for petty cash" });
        if (m <= "2026-10-01") {
          const p = await createPayroll(c, SU, co, m.slice(0, 7));
          await postPayroll(c, SU, p.id);
          await payPayroll(c, SU, p.id, { bank_account_id: bank.id, pay_date: cap(addDays(monthEnd(m.slice(0, 7)), 3)) });
        }
      }
      for (const [name, amt] of [["Marketing", 45000 * 8], ["Office Rent", [35000, 60000, 28000][ci] * 12], ["Software Subscriptions", 20000 * 12], ["Electricity", 9000 * 12]] as [string, number][])
        await c.query("INSERT INTO budgets(company_id,fy,category_id,department,month,amount) VALUES ($1,'2026-27',$2,'Operations',NULL,$3) ON CONFLICT DO NOTHING", [co, await cat("expense", name), amt]);
      await c.query("INSERT INTO budgets(company_id,fy,category_id,department,month,amount) VALUES ($1,'2026-27',$2,'Growth',11,$3) ON CONFLICT DO NOTHING", [co, await cat("expense", "Marketing"), 20000]);
      await createTaxRecord(c, SU, { company_id: co, kind: "gst_payment", record_date: "2026-10-18", period: "2026-09", cgst: 20000, sgst: 20000, igst: 0, bank_account_id: bank.id, reference: "Challan (sample)" });
    }
  });
  console.log("seed complete");
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
