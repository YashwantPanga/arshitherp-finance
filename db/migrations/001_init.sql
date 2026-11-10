-- Arshith Group Finance ERP — core schema (PostgreSQL 14+)
-- Money = numeric(18,2). Every financial row carries company_id. The journal is the single source of truth for reports.

CREATE TYPE user_role AS ENUM ('SUPER_ADMIN','COMPANY_ADMIN','ACCOUNTANT','VIEWER');
CREATE TYPE account_type AS ENUM ('asset','liability','equity','income','expense');
CREATE TYPE doc_status AS ENUM ('draft','pending_approval','posted','voided');

CREATE TABLE companies (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  legal_name text,
  business_type text,
  gstin text, pan text,
  address text, city text, state text, state_code text, pincode text,
  phone text, email text,
  logo_text text,
  brand_color text DEFAULT '#00a76f',
  invoice_prefix text NOT NULL, bill_prefix text NOT NULL,
  payment_terms text DEFAULT 'Payable within 15 days of invoice date.',
  bank_details text,
  gst_registered boolean NOT NULL DEFAULT true,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_profiles (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'VIEWER',
  active boolean NOT NULL DEFAULT true,
  reset_token_hash text, reset_expires timestamptz,
  failed_logins int NOT NULL DEFAULT 0, locked_until timestamptz,
  last_login timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_memberships (
  user_id int NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE sessions (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text, ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);

-- Chart of accounts (per company). subtype drives report classification and is configurable per account.
CREATE TABLE accounts (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  type account_type NOT NULL,
  subtype text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);
CREATE INDEX ON accounts (company_id, subtype);

-- Configurable income / expense categories, each mapped to a ledger account
CREATE TABLE account_categories (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  name text NOT NULL,
  account_id int NOT NULL REFERENCES accounts(id),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, kind, name)
);

CREATE TABLE customers (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  name text NOT NULL, email text, phone text, gstin text, address text, state_code text,
  credit_days int NOT NULL DEFAULT 15,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vendors (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  name text NOT NULL, email text, phone text, gstin text, pan text, address text, state_code text,
  credit_days int NOT NULL DEFAULT 15,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE employees (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  emp_code text NOT NULL, name text NOT NULL, email text, phone text, designation text, department text,
  join_date date, pan text,
  basic numeric(18,2) NOT NULL DEFAULT 0,
  allowances numeric(18,2) NOT NULL DEFAULT 0,
  deductions numeric(18,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, emp_code)
);

-- Bank / cash accounts. Each is backed by its own ledger account.
CREATE TABLE bank_accounts (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  account_id int NOT NULL REFERENCES accounts(id),
  name text NOT NULL,
  bank_name text,
  account_type text NOT NULL CHECK (account_type IN ('cash','bank','upi','wallet')),
  account_ref text,               -- masked, e.g. XXXX1234 (full numbers are never stored)
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  opening_date date NOT NULL DEFAULT CURRENT_DATE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE financial_periods (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  label text NOT NULL, start_date date NOT NULL, end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  UNIQUE (company_id, label)
);

CREATE TABLE doc_sequences (
  company_id int NOT NULL REFERENCES companies(id),
  kind text NOT NULL, fy text NOT NULL, last_no int NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, kind, fy)
);

-- ===== General ledger =====
CREATE TABLE journal_entries (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  entry_no text NOT NULL,
  entry_date date NOT NULL,
  memo text,
  source_type text NOT NULL,       -- transaction, invoice, payment, bill, bill_payment, payroll, tax, bank, opening
  source_id int,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  reverses_entry_id int REFERENCES journal_entries(id),
  created_by int REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, entry_no)
);
CREATE INDEX ON journal_entries (company_id, entry_date);
CREATE INDEX ON journal_entries (source_type, source_id);

CREATE TABLE journal_entry_lines (
  id serial PRIMARY KEY,
  entry_id int NOT NULL REFERENCES journal_entries(id),
  company_id int NOT NULL REFERENCES companies(id),
  account_id int NOT NULL REFERENCES accounts(id),
  debit numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo text,
  CHECK ((debit = 0) <> (credit = 0))
);
CREATE INDEX ON journal_entry_lines (entry_id);
CREATE INDEX ON journal_entry_lines (company_id, account_id);

-- ===== Cash transactions: income / expense / refund / transfer =====
CREATE TABLE transactions (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  txn_no text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income','expense','refund','transfer','capital','drawing','loan_in','loan_repay')),
  txn_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),      -- gross amount actually moved (incl. tax)
  tax_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  tds_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  tax_type text DEFAULT 'GST',    -- GST (intra-state CGST+SGST) | IGST | NONE
  status doc_status NOT NULL DEFAULT 'draft',
  category_id int REFERENCES account_categories(id),
  bank_account_id int NOT NULL REFERENCES bank_accounts(id),
  to_bank_account_id int REFERENCES bank_accounts(id),
  customer_id int REFERENCES customers(id),
  vendor_id int REFERENCES vendors(id),
  party_name text,
  invoice_no text,
  payment_method text,
  reference text,
  description text,
  recurring text CHECK (recurring IN ('monthly','quarterly','yearly')),
  next_run date,
  project text,
  payment_status text NOT NULL DEFAULT 'received',
  journal_entry_id int REFERENCES journal_entries(id),
  created_by int REFERENCES user_profiles(id),
  approved_by int REFERENCES user_profiles(id), approved_at timestamptz,
  voided_by int REFERENCES user_profiles(id), voided_at timestamptz, void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, txn_no),
  CHECK (kind <> 'transfer' OR (to_bank_account_id IS NOT NULL AND to_bank_account_id <> bank_account_id))
);
CREATE INDEX ON transactions (company_id, kind, txn_date);
CREATE INDEX ON transactions (company_id, status);

-- ===== Invoices (receivables) =====
CREATE TABLE invoices (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  invoice_no text NOT NULL,
  customer_id int NOT NULL REFERENCES customers(id),
  issue_date date NOT NULL, due_date date NOT NULL,
  status doc_status NOT NULL DEFAULT 'draft',
  place_of_supply text, tax_type text NOT NULL DEFAULT 'GST',
  subtotal numeric(18,2) NOT NULL DEFAULT 0,
  discount_total numeric(18,2) NOT NULL DEFAULT 0,
  cgst numeric(18,2) NOT NULL DEFAULT 0, sgst numeric(18,2) NOT NULL DEFAULT 0, igst numeric(18,2) NOT NULL DEFAULT 0,
  total numeric(18,2) NOT NULL DEFAULT 0,
  amount_paid numeric(18,2) NOT NULL DEFAULT 0,
  project text, notes text, terms text,
  journal_entry_id int REFERENCES journal_entries(id),
  created_by int REFERENCES user_profiles(id),
  voided_by int REFERENCES user_profiles(id), voided_at timestamptz, void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_no),
  CHECK (amount_paid >= 0 AND amount_paid <= total)
);
CREATE INDEX ON invoices (company_id, status, due_date);
CREATE TABLE invoice_items (
  id serial PRIMARY KEY,
  invoice_id int NOT NULL REFERENCES invoices(id),
  company_id int NOT NULL REFERENCES companies(id),
  description text NOT NULL, hsn_sac text,
  category_id int REFERENCES account_categories(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  discount numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  taxable numeric(18,2) NOT NULL, tax numeric(18,2) NOT NULL, amount numeric(18,2) NOT NULL
);

-- ===== Bills (payables) =====
CREATE TABLE bills (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  bill_no text NOT NULL,
  vendor_id int NOT NULL REFERENCES vendors(id),
  vendor_bill_ref text,
  bill_date date NOT NULL, due_date date NOT NULL,
  status doc_status NOT NULL DEFAULT 'draft',
  tax_type text NOT NULL DEFAULT 'GST',
  subtotal numeric(18,2) NOT NULL DEFAULT 0,
  cgst numeric(18,2) NOT NULL DEFAULT 0, sgst numeric(18,2) NOT NULL DEFAULT 0, igst numeric(18,2) NOT NULL DEFAULT 0,
  tds_amount numeric(18,2) NOT NULL DEFAULT 0,
  total numeric(18,2) NOT NULL DEFAULT 0,
  amount_paid numeric(18,2) NOT NULL DEFAULT 0,
  notes text,
  journal_entry_id int REFERENCES journal_entries(id),
  created_by int REFERENCES user_profiles(id),
  voided_by int REFERENCES user_profiles(id), voided_at timestamptz, void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, bill_no),
  CHECK (amount_paid >= 0 AND amount_paid <= total - tds_amount)
);
CREATE INDEX ON bills (company_id, status, due_date);
CREATE TABLE bill_items (
  id serial PRIMARY KEY,
  bill_id int NOT NULL REFERENCES bills(id),
  company_id int NOT NULL REFERENCES companies(id),
  description text NOT NULL,
  category_id int REFERENCES account_categories(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  taxable numeric(18,2) NOT NULL, tax numeric(18,2) NOT NULL, amount numeric(18,2) NOT NULL
);

-- Receipts against invoices and payments against bills
CREATE TABLE payments (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  direction text NOT NULL CHECK (direction IN ('receipt','payment')),
  invoice_id int REFERENCES invoices(id),
  bill_id int REFERENCES bills(id),
  bank_account_id int NOT NULL REFERENCES bank_accounts(id),
  pay_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  method text, reference text, notes text,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','voided')),
  journal_entry_id int REFERENCES journal_entries(id),
  created_by int REFERENCES user_profiles(id),
  voided_by int REFERENCES user_profiles(id), voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((direction = 'receipt' AND invoice_id IS NOT NULL AND bill_id IS NULL)
      OR (direction = 'payment' AND bill_id IS NOT NULL AND invoice_id IS NULL))
);
CREATE INDEX ON payments (company_id, direction, pay_date);

CREATE TABLE bank_reconciliations (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  bank_account_id int NOT NULL REFERENCES bank_accounts(id),
  statement_date date NOT NULL,
  statement_balance numeric(18,2) NOT NULL,
  book_balance numeric(18,2) NOT NULL,
  difference numeric(18,2) NOT NULL,
  reconciled_by int REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reconciled_lines (
  line_id int PRIMARY KEY REFERENCES journal_entry_lines(id),
  reconciliation_id int NOT NULL REFERENCES bank_reconciliations(id),
  company_id int NOT NULL REFERENCES companies(id)
);

CREATE TABLE budgets (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  fy text NOT NULL,
  category_id int NOT NULL REFERENCES account_categories(id),
  department text,
  month int CHECK (month BETWEEN 1 AND 12),     -- NULL = whole financial year
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, fy, category_id, month)
);

CREATE TABLE tax_records (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  kind text NOT NULL CHECK (kind IN ('gst_payment','itc_setoff','tds_payment','tds_certificate')),
  record_date date NOT NULL, period text,
  cgst numeric(18,2) NOT NULL DEFAULT 0, sgst numeric(18,2) NOT NULL DEFAULT 0, igst numeric(18,2) NOT NULL DEFAULT 0,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  bank_account_id int REFERENCES bank_accounts(id),
  reference text, notes text,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','voided')),
  verified_by int REFERENCES user_profiles(id), verified_at timestamptz,
  journal_entry_id int REFERENCES journal_entries(id),
  created_by int REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payroll (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  month text NOT NULL,                       -- YYYY-MM
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','paid','voided')),
  total_gross numeric(18,2) NOT NULL DEFAULT 0,
  total_deductions numeric(18,2) NOT NULL DEFAULT 0,
  total_net numeric(18,2) NOT NULL DEFAULT 0,
  journal_entry_id int REFERENCES journal_entries(id),
  created_by int REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, month)
);
CREATE TABLE payroll_items (
  id serial PRIMARY KEY,
  payroll_id int NOT NULL REFERENCES payroll(id),
  company_id int NOT NULL REFERENCES companies(id),
  employee_id int NOT NULL REFERENCES employees(id),
  basic numeric(18,2) NOT NULL, allowances numeric(18,2) NOT NULL DEFAULT 0,
  deductions numeric(18,2) NOT NULL DEFAULT 0, advance_recovery numeric(18,2) NOT NULL DEFAULT 0,
  net numeric(18,2) NOT NULL,
  paid_amount numeric(18,2) NOT NULL DEFAULT 0,
  paid_date date,
  UNIQUE (payroll_id, employee_id),
  CHECK (paid_amount <= net)
);
CREATE TABLE employee_advances (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  employee_id int NOT NULL REFERENCES employees(id),
  advance_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  bank_account_id int NOT NULL REFERENCES bank_accounts(id),
  notes text,
  journal_entry_id int REFERENCES journal_entries(id),
  created_by int REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attachments (
  id serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id),
  entity_type text NOT NULL, entity_id int NOT NULL,
  filename text NOT NULL, mime text NOT NULL, size int NOT NULL,
  storage_key text NOT NULL UNIQUE, sha256 text NOT NULL,
  uploaded_by int REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON attachments (entity_type, entity_id);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  user_id int, user_email text,
  company_id int,
  action text NOT NULL,
  entity_type text NOT NULL, entity_id text,
  before jsonb, after jsonb, note text, ip text
);
CREATE INDEX ON audit_logs (company_id, ts DESC);
CREATE INDEX ON audit_logs (entity_type, entity_id);

-- ===== Integrity triggers =====
-- Journal entries must balance (checked at commit time).
CREATE FUNCTION check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c FROM journal_entry_lines WHERE entry_id = NEW.entry_id;
  IF d <> c THEN RAISE EXCEPTION 'Journal entry % is unbalanced: debit % <> credit %', NEW.entry_id, d, c; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_entry_balanced AFTER INSERT ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- Posted ledger rows are immutable: no edits, no deletes. Corrections are reversal entries.
CREATE FUNCTION forbid_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' AND TG_OP = 'UPDATE' THEN
    IF NEW.status = 'reversed' AND OLD.status = 'posted'
       AND (NEW.id, NEW.company_id, NEW.entry_no, NEW.entry_date, NEW.source_type) IS NOT DISTINCT FROM (OLD.id, OLD.company_id, OLD.entry_no, OLD.entry_date, OLD.source_type)
    THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Posted ledger records cannot be changed or deleted; post a reversal instead (%.%)', TG_TABLE_NAME, TG_OP;
END $$;
CREATE TRIGGER trg_je_immutable BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();
CREATE TRIGGER trg_jel_immutable BEFORE UPDATE OR DELETE ON journal_entry_lines FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();

-- Posted business documents cannot be hard-deleted (void them instead).
CREATE FUNCTION forbid_delete_posted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status::text <> 'draft' THEN
    RAISE EXCEPTION 'Cannot delete a % record in status %; void it instead', TG_TABLE_NAME, OLD.status;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_nodel_txn BEFORE DELETE ON transactions FOR EACH ROW EXECUTE FUNCTION forbid_delete_posted();
CREATE TRIGGER trg_nodel_inv BEFORE DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION forbid_delete_posted();
CREATE TRIGGER trg_nodel_bill BEFORE DELETE ON bills FOR EACH ROW EXECUTE FUNCTION forbid_delete_posted();
CREATE TRIGGER trg_nodel_payroll BEFORE DELETE ON payroll FOR EACH ROW EXECUTE FUNCTION forbid_delete_posted();
CREATE FUNCTION forbid_delete_always() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Cannot delete % records; void them instead', TG_TABLE_NAME; END $$;
CREATE TRIGGER trg_nodel_pay BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_delete_always();
CREATE TRIGGER trg_nodel_tax BEFORE DELETE ON tax_records FOR EACH ROW EXECUTE FUNCTION forbid_delete_always();

-- Block posting into closed financial periods.
CREATE FUNCTION check_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM financial_periods p WHERE p.company_id = NEW.company_id AND p.status = 'closed'
             AND NEW.entry_date BETWEEN p.start_date AND p.end_date) THEN
    RAISE EXCEPTION 'Financial period is closed for %', NEW.entry_date;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_period_open BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION check_period_open();

-- ===== Database-level authorization (row level security) =====
-- The app connects as owner for auth and switches to erp_app (SET LOCAL ROLE) for every data query,
-- passing the caller's company ids through app.company_ids. Super admins pass app.is_super = '1'.
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='erp_app') THEN CREATE ROLE erp_app NOLOGIN; END IF; END $$;
CREATE FUNCTION app_company_ok(cid int) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.is_super', true) = '1'
      OR cid = ANY (string_to_array(coalesce(nullif(current_setting('app.company_ids', true), ''), '0'), ',')::int[])
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema='public' AND column_name='company_id'
             AND table_name NOT IN ('company_memberships','audit_logs')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I USING (app_company_ok(company_id)) WITH CHECK (app_company_ok(company_id))', t);
  END LOOP;
END $$;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON companies USING (app_company_ok(id)) WITH CHECK (app_company_ok(id));
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_logs FOR SELECT USING (company_id IS NULL AND current_setting('app.is_super', true) = '1' OR company_id IS NOT NULL AND app_company_ok(company_id));
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
REVOKE UPDATE, DELETE ON audit_logs, journal_entry_lines FROM erp_app;
REVOKE ALL ON user_profiles, sessions, company_memberships FROM erp_app;
CREATE VIEW user_names AS SELECT id, name, email FROM user_profiles;
GRANT SELECT ON user_names TO erp_app;
