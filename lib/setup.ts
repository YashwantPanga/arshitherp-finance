// Company onboarding: chart of accounts, default categories, financial periods.
import { Client, SessionUser, q1 } from "./db";
import { fyOf, fyRange } from "./core";

export const COA: [string, string, "asset" | "liability" | "equity" | "income" | "expense", string][] = [
  ["1100", "Accounts Receivable", "asset", "receivable"],
  ["1200", "Inventory", "asset", "inventory"],
  ["1300", "Equipment & Fixed Assets", "asset", "fixed_asset"],
  ["1410", "Input CGST", "asset", "input_cgst"],
  ["1420", "Input SGST", "asset", "input_sgst"],
  ["1430", "Input IGST", "asset", "input_igst"],
  ["1500", "Employee Advances", "asset", "employee_advance"],
  ["1900", "Other Assets", "asset", "other_asset"],
  ["2000", "Accounts Payable", "liability", "payable"],
  ["2100", "Loans", "liability", "loan"],
  ["2200", "Outstanding Expenses", "liability", "outstanding_expense"],
  ["2310", "Output CGST", "liability", "output_cgst"],
  ["2320", "Output SGST", "liability", "output_sgst"],
  ["2330", "Output IGST", "liability", "output_igst"],
  ["2340", "TDS & Statutory Payable", "liability", "tds_payable"],
  ["2400", "Salary Payable", "liability", "salary_payable"],
  ["2900", "Other Liabilities", "liability", "other_liability"],
  ["3000", "Owner's Capital", "equity", "capital"],
  ["3100", "Retained Earnings", "equity", "retained"],
  ["3900", "Opening Balance Equity", "equity", "opening_equity"],
  ["4000", "General Sales Revenue", "income", "revenue"],
  ["4010", "Product Sales", "income", "revenue"],
  ["4020", "Service Income", "income", "revenue"],
  ["4030", "Course Sales", "income", "revenue"],
  ["4040", "Subscription Income", "income", "revenue"],
  ["4050", "Software Project Revenue", "income", "revenue"],
  ["4090", "Other Income", "income", "other_income"],
  ["4100", "Sales Discounts", "income", "discount"],
  ["4110", "Sales Returns & Refunds", "income", "sales_return"],
  ["5010", "Purchases", "expense", "direct_cost"],
  ["5020", "Payment Gateway Charges", "expense", "direct_cost"],
  ["5030", "Project Direct Costs", "expense", "direct_cost"],
  ["6010", "Salaries & Wages", "expense", "operating_expense"],
  ["6020", "Office Rent", "expense", "operating_expense"],
  ["6030", "Electricity", "expense", "operating_expense"],
  ["6040", "Internet & Telephone", "expense", "operating_expense"],
  ["6050", "Software Subscriptions", "expense", "operating_expense"],
  ["6060", "Marketing", "expense", "operating_expense"],
  ["6070", "Advertising", "expense", "operating_expense"],
  ["6080", "Travel", "expense", "operating_expense"],
  ["6090", "Transportation", "expense", "operating_expense"],
  ["6110", "Maintenance", "expense", "operating_expense"],
  ["6120", "Professional Fees", "expense", "operating_expense"],
  ["6130", "Taxes & Licences", "expense", "operating_expense"],
  ["6140", "Bank Charges", "expense", "operating_expense"],
  ["6190", "Other Expenses", "expense", "operating_expense"],
];

// [kind, category name, account code]
export const CATEGORIES: ["income" | "expense", string, string][] = [
  ["income", "Cash Income", "4000"], ["income", "Customer Payments", "4000"], ["income", "Service Income", "4020"],
  ["income", "Product Sales", "4010"], ["income", "Course Sales", "4030"], ["income", "Subscription Income", "4040"],
  ["income", "Software Project Revenue", "4050"], ["income", "Other Income", "4090"],
  ["expense", "Salaries", "6010"], ["expense", "Office Rent", "6020"], ["expense", "Electricity", "6030"], ["expense", "Internet", "6040"],
  ["expense", "Software Subscriptions", "6050"], ["expense", "Marketing", "6060"], ["expense", "Advertising", "6070"], ["expense", "Travel", "6080"],
  ["expense", "Transportation", "6090"], ["expense", "Purchases", "5010"], ["expense", "Inventory", "1200"], ["expense", "Equipment", "1300"],
  ["expense", "Maintenance", "6110"], ["expense", "Professional Fees", "6120"], ["expense", "Taxes", "6130"], ["expense", "Payment Gateway Charges", "5020"],
  ["expense", "Project Direct Costs", "5030"], ["expense", "Bank Charges", "6140"], ["expense", "Other Expenses", "6190"],
];

export async function onboardCompany(c: Client, co: { id: number }) {
  for (const [code, name, type, subtype] of COA)
    await c.query("INSERT INTO accounts(company_id,code,name,type,subtype,is_system) VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT DO NOTHING", [co.id, code, name, type, subtype]);
  for (const [kind, name, code] of CATEGORIES) {
    const a = await q1(c, "SELECT id FROM accounts WHERE company_id=$1 AND code=$2", [co.id, code]);
    await c.query("INSERT INTO account_categories(company_id,kind,name,account_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [co.id, kind, name, a!.id]);
  }
  const now = fyOf(new Date().toISOString().slice(0, 10));
  for (let y = +now.slice(0, 4) - 2; y <= +now.slice(0, 4) + 1; y++) {
    const label = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    const r = fyRange(label);
    await c.query("INSERT INTO financial_periods(company_id,label,start_date,end_date) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [co.id, label, r.start, r.end]);
  }
}

export type { SessionUser };
