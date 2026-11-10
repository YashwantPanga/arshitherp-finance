"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Col, Form, Row, Spinner, Tab, Tabs } from "react-bootstrap";
import { useApp, useQuery } from "components/erp/AppProvider";
import { DataTable, FieldDef, Fields, FormModal, Money, PageHeader, SectionCard, Status } from "components/erp/ui";
import { api, fmtDate, fmtTs, inr } from "lib/client";

const PROFILE: FieldDef[] = [
  { name: "name", label: "Display name", required: true }, { name: "legal_name", label: "Legal name" }, { name: "business_type", label: "Business type" },
  { name: "gst_registered", label: "GST registered", type: "checkbox" }, { name: "gstin", label: "GSTIN", hint: "15 characters, e.g. 36AAAPA0001A1Z5" }, { name: "pan", label: "PAN" },
  { name: "address", label: "Address", col: 12 }, { name: "city", label: "City", col: 3 }, { name: "state", label: "State", col: 3 }, { name: "state_code", label: "State code", col: 3 }, { name: "pincode", label: "PIN code", col: 3 },
  { name: "phone", label: "Phone" }, { name: "email", label: "Email", type: "email" }, { name: "logo_text", label: "Logo initials (2 letters)", col: 3 }, { name: "brand_color", label: "Brand colour", type: "text", col: 3, hint: "#RRGGBB used on invoices" },
  { name: "payment_terms", label: "Default invoice payment terms", type: "textarea", col: 12 }, { name: "bank_details", label: "Bank details printed on invoices", type: "textarea", col: 12 },
];

function CompanyProfile() {
  const { meta, toast, reload } = useApp();
  const [id, setId] = useState(String(meta!.companies[0]?.id)); const co = meta!.companies.find((c) => String(c.id) === id);
  const [v, setV] = useState<any>(co); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { setV(co); setErr(""); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const FEATURES = [["inventory", "Inventory & product-wise revenue"], ["projects", "Project-wise revenue & expenses"], ["courses", "Course-wise income & student payments"], ["subscriptions", "Subscription revenue"], ["refunds", "Refund tracking"], ["payroll", "Payroll module in use"]];
  const save = async () => { setBusy(true); setErr(""); try { await api(`/companies/${id}`, { method: "PUT", body: v }); toast("Company profile saved"); reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  if (!v) return null;
  return (
    <SectionCard title="Company profile" actions={<Form.Select size="sm" value={id} onChange={(e) => setId(e.target.value)} style={{ width: 200 }}>{meta!.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Form.Select>}>
      <Fields fields={PROFILE} values={v} set={(k, val) => setV({ ...v, [k]: val })} />
      <div className="mt-4"><div className="fw-semibold small mb-2">Business focus tags (informational — every module stays available; use the Product / Project / Course field on income, expenses and invoices for product-wise, project-wise or course-wise reporting)</div>
        <div className="d-flex flex-wrap gap-4">{FEATURES.map(([k, l]) => <Form.Check key={k} type="switch" id={`ft-${k}`} label={l} checked={!!v.features?.[k]} onChange={(e) => setV({ ...v, features: { ...(v.features || {}), [k]: e.target.checked } })} />)}</div></div>
      <div className="small text-secondary mt-3">Invoice numbering: <strong>{v.invoice_prefix}/&lt;FY&gt;/0001</strong> · Bills: <strong>{v.bill_prefix}/&lt;FY&gt;/0001</strong> — a separate sequence per company, restarting each financial year.</div>
      {err && <div className="alert alert-danger py-2 mt-3 mb-0 small">{err}</div>}
      <Button className="mt-4" onClick={save} disabled={busy}>{busy && <Spinner size="sm" className="me-2" />}Save profile</Button>
    </SectionCard>
  );
}

function Categories() {
  const { meta, company, toast, reload: rm } = useApp();
  const { data, reload } = useQuery<any[]>("/categories", {}, { scoped: true, range: false });
  const { data: accts } = useQuery<any[]>("/accounts", {}, { scoped: true, range: false });
  const [show, setShow] = useState(false);
  const mine = meta!.companies;
  return (
    <SectionCard title="Income & expense categories" actions={<Button size="sm" onClick={() => setShow(true)}><i className="ti ti-plus me-1" />Add category</Button>} flush>
      <DataTable dense rows={data} cols={[
        { key: "company", header: "Company", render: (c: any) => meta!.companies.find((x) => x.id === c.company_id)?.name }, { key: "kind", header: "Type", render: (c: any) => <Badge bg={c.kind === "income" ? "success-subtle" : "danger-subtle"} text={c.kind === "income" ? "success-emphasis" : "danger-emphasis"}>{c.kind}</Badge> },
        { key: "name", header: "Category", render: (c: any) => <span className={c.active ? "fw-semibold" : "text-secondary text-decoration-line-through"}>{c.name}</span> }, { key: "acc", header: "Ledger account", render: (c: any) => `${c.account_code} ${c.account_name}` },
        { key: "cls", header: "P&L class", hideMobile: true, render: (c: any) => c.subtype.replace("_", " ") },
        { key: "a", header: "", align: "end", render: (c: any) => <Button size="sm" variant="light" onClick={async () => { await api(`/categories/${c.id}`, { method: "PUT", body: { active: !c.active } }); reload(); rm(); }}>{c.active ? "Disable" : "Enable"}</Button> }]} />
      <FormModal show={show} title="Add category" onClose={() => setShow(false)} initial={{ company_id: company !== "all" ? company : "", kind: "expense" }}
        fields={[{ name: "company_id", label: "Company", type: "select", required: true, options: mine.map((c) => ({ value: c.id, label: c.name })) }, { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "income", label: "Income" }, { value: "expense", label: "Expense" }] }, { name: "name", label: "Category name", required: true },
          { name: "account_id", label: "Ledger account (decides P&L / balance-sheet treatment)", type: "select", required: true, col: 12, options: (v) => (accts || []).filter((a) => String(a.company_id) === String(v.company_id) && (v.kind === "income" ? a.type === "income" : ["expense", "asset"].includes(a.type))).map((a) => ({ value: a.id, label: `${a.code} ${a.name} (${a.subtype.replace("_", " ")})` })) }]}
        transform={(o, k, val) => (k === "company_id" || k === "kind" ? { ...o, [k]: val, account_id: "" } : { ...o, [k]: val })}
        onSubmit={async (v) => { await api("/categories", { body: { ...v, company_id: +v.company_id, account_id: +v.account_id } }); toast("Category added"); setShow(false); reload(); rm(); }}>
        {() => <div className="small text-secondary mt-3">Map an expense category to an asset account (e.g. Equipment → Fixed Assets) to capitalise it instead of expensing it.</div>}
      </FormModal>
    </SectionCard>
  );
}

function Accounts() {
  const { meta, company, toast } = useApp();
  const { data, reload } = useQuery<any[]>("/accounts", {}, { scoped: true, range: false });
  const [show, setShow] = useState(false);
  return (
    <SectionCard title="Chart of accounts" actions={<Button size="sm" onClick={() => setShow(true)}><i className="ti ti-plus me-1" />Add account</Button>} flush>
      <DataTable dense rows={data} cols={[{ key: "co", header: "Company", render: (a: any) => meta!.companies.find((x) => x.id === a.company_id)?.code }, { key: "code", header: "Code" }, { key: "name", header: "Account", render: (a: any) => <span className="fw-semibold">{a.name}</span> }, { key: "type", header: "Type" }, { key: "subtype", header: "Classification", hideMobile: true, render: (a: any) => a.subtype.replace(/_/g, " ") }, { key: "balance", header: "Balance (Dr − Cr)", align: "end", render: (a: any) => <Money v={a.balance} /> }]} />
      <FormModal show={show} title="Add ledger account" size="lg" onClose={() => setShow(false)} initial={{ company_id: company !== "all" ? company : "", type: "expense" }}
        fields={[{ name: "company_id", label: "Company", type: "select", required: true, options: meta!.companies.map((c) => ({ value: c.id, label: c.name })) }, { name: "code", label: "Code (4 digits)", required: true }, { name: "name", label: "Name", required: true },
          { name: "type", label: "Type", type: "select", required: true, options: ["asset", "liability", "equity", "income", "expense"].map((t) => ({ value: t, label: t })) },
          { name: "subtype", label: "Classification", type: "select", options: (v) => (v.type === "expense" ? [["operating_expense", "Operating expense"], ["direct_cost", "Direct cost (COGS)"]] : v.type === "income" ? [["revenue", "Revenue"], ["other_income", "Other income"]] : [[`other_${v.type}`, "Other"]]).map(([value, label]) => ({ value, label })) }]}
        onSubmit={async (v) => { await api("/accounts", { body: { ...v, company_id: +v.company_id } }); toast("Account added"); setShow(false); reload(); }} />
    </SectionCard>
  );
}

function Periods() {
  const { toast, reload: rm } = useApp(); const { meta } = useApp();
  return (
    <SectionCard title="Financial periods (April – March)" flush>
      <DataTable dense rows={meta!.periods} cols={[{ key: "co", header: "Company", render: (p: any) => meta!.companies.find((c) => c.id === p.company_id)?.name }, { key: "label", header: "Financial year", render: (p: any) => `FY ${p.label}` }, { key: "r", header: "Range", render: (p: any) => `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}` }, { key: "s", header: "Status", render: (p: any) => <Status value={p.status} /> },
        { key: "a", header: "", align: "end", render: (p: any) => <Button size="sm" variant="light" onClick={async () => { await api(`/periods/${p.id}/status`, { body: { status: p.status === "open" ? "closed" : "open" } }); toast(p.status === "open" ? "Period closed — no further posting allowed" : "Period reopened"); rm(); }}>{p.status === "open" ? "Close period" : "Reopen"}</Button> }]} />
      <div className="small text-secondary p-4">Closing a period blocks any new or reversing ledger entry dated inside it (enforced by a database trigger).</div>
    </SectionCard>
  );
}

function Backups() {
  const { toast } = useApp();
  const { data, reload } = useQuery<any[]>("/admin/backups", {}, { scoped: false, range: false });
  const [busy, setBusy] = useState(false);
  return (
    <SectionCard title="Database backups" actions={<Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api<any>("/admin/backups", { body: {} }); toast(`Backup created: ${r.file}`); reload(); } catch (e: any) { toast(e.message, "danger"); } finally { setBusy(false); } }}>{busy && <Spinner size="sm" className="me-2" />}Create backup now</Button>} flush>
      <DataTable dense rows={data} empty="No backups yet" cols={[{ key: "name", header: "File" }, { key: "size", header: "Size", render: (b: any) => `${(b.size / 1024).toFixed(0)} KB` }, { key: "created", header: "Created", render: (b: any) => fmtTs(b.created) }]} />
      <div className="small text-secondary p-4">Uses <code>pg_dump</code> (custom format) into <code>storage/backups</code>. For production, schedule this daily (cron / Task Scheduler) and copy the files off the server. Restore with <code>pg_restore</code>.</div>
    </SectionCard>
  );
}

function Security() {
  const { toast } = useApp();
  const { data: sessions, reload } = useQuery<any[]>("/auth/sessions", {}, { scoped: false, range: false });
  const [cur, setCur] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  return (
    <Row className="g-4">
      <Col lg={5}><SectionCard title="Change password">
        <Form.Control className="mb-2" type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        <Form.Control className="mb-2" type="password" placeholder="New password (min 10, mixed case + number)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        {err && <div className="alert alert-danger py-2 small">{err}</div>}
        <Button onClick={async () => { try { await api("/auth/password", { body: { current: cur, password: pw } }); toast("Password changed"); setCur(""); setPw(""); setErr(""); } catch (e: any) { setErr(e.message); } }}>Update password</Button>
      </SectionCard></Col>
      <Col lg={7}><SectionCard title="Active sessions" actions={<Button size="sm" variant="light" onClick={async () => { await api("/auth/sessions/revoke-others", { body: {} }); toast("Other sessions signed out"); reload(); }}>Sign out other sessions</Button>} flush>
        <DataTable dense rows={sessions} cols={[{ key: "ua", header: "Device", render: (s: any) => (s.user_agent || "—").slice(0, 46) }, { key: "ip", header: "IP", render: (s: any) => s.ip || "—" }, { key: "seen", header: "Last seen", render: (s: any) => fmtTs(s.last_seen) }, { key: "x", header: "Expires", hideMobile: true, render: (s: any) => fmtTs(s.expires_at) },
          { key: "a", header: "", render: (s: any) => <Button size="sm" variant="light" className="text-danger" onClick={async () => { await api(`/auth/sessions/${s.id}/revoke`, { body: {} }); reload(); }}>Revoke</Button> }]} />
      </SectionCard></Col>
    </Row>
  );
}

function NewCompany() {
  const { toast, reload } = useApp(); const [show, setShow] = useState(false);
  return (
    <>
      <Alert variant="light" className="d-flex justify-content-between align-items-center"><span>Add another business to the group. A chart of accounts, categories and financial periods are created automatically.</span><Button size="sm" onClick={() => setShow(true)}>Add company</Button></Alert>
      <FormModal show={show} title="Add company" size="lg" onClose={() => setShow(false)} initial={{}} fields={[{ name: "code", label: "Short code (2–5 capitals)", required: true, hint: "Prefixes document numbers, e.g. AFR" }, { name: "name", label: "Company name", required: true }, { name: "legal_name", label: "Legal name" }, { name: "gstin", label: "GSTIN" }, { name: "state_code", label: "State code" }]}
        onSubmit={async (v) => { await api("/companies", { body: v }); toast("Company created"); setShow(false); reload(); }} />
    </>
  );
}

export default function Settings() {
  const { can } = useApp();
  return (
    <>
      <PageHeader title="Settings" subtitle="Company profile, accounting configuration, periods, backups and your own security" />
      <Tabs defaultActiveKey={can("company.manage") ? "company" : "security"} className="mb-4" mountOnEnter>
        {can("company.manage") && <Tab eventKey="company" title="Company profile"><NewCompany /><CompanyProfile /></Tab>}
        {can("master.write") && <Tab eventKey="cats" title="Categories"><Categories /></Tab>}
        {can("company.manage") && <Tab eventKey="coa" title="Chart of accounts"><Accounts /></Tab>}
        {can("settings") && <Tab eventKey="periods" title="Financial periods"><Periods /></Tab>}
        {can("settings") && <Tab eventKey="backup" title="Backups"><Backups /></Tab>}
        <Tab eventKey="security" title="My security"><Security /></Tab>
      </Tabs>
    </>
  );
}
void inr;
