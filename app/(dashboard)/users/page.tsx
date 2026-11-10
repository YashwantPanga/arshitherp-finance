"use client";
import { useState } from "react";
import { Alert, Badge, Button, Form, Modal, Table } from "react-bootstrap";
import { useApp, useQuery } from "components/erp/AppProvider";
import { DataTable, FormModal, PageHeader, SectionCard } from "components/erp/ui";
import { api, fmtTs } from "lib/client";

const ROLES = [
  { value: "SUPER_ADMIN", label: "Super Admin — all companies, users, settings, approvals" }, { value: "COMPANY_ADMIN", label: "Company Admin — assigned companies, transactions, payroll" },
  { value: "ACCOUNTANT", label: "Accountant — entries, invoices, reconciliation, reports" }, { value: "VIEWER", label: "Viewer — read-only" },
];
const PERMS: [string, string, boolean[]][] = [
  ["View dashboards & reports", "", [true, true, true, true]], ["Add / edit income, expenses, banking", "", [true, true, true, false]], ["Create invoices & bills, record payments", "", [true, true, true, false]],
  ["Approve expenses", "", [true, false, false, false]], ["Bank reconciliation", "", [true, true, true, false]], ["Payroll", "", [true, true, false, false]], ["Budgets, GST & tax records", "", [true, true, true, false]],
  ["Audit log", "", [true, true, false, false]], ["Companies, users, settings, backups", "", [true, false, false, false]],
];

export default function Users() {
  const { meta, toast, can } = useApp();
  const { data: users, reload } = useQuery<any[]>("/users", {}, { scoped: false, range: false });
  const [form, setForm] = useState<{ show: boolean; edit?: any }>({ show: false }); const [pw, setPw] = useState<any>(null); const [pwv, setPwv] = useState(""); const [err, setErr] = useState("");
  if (!can("users.manage")) return <Alert variant="warning">You do not have access to user management.</Alert>;
  const fields = [
    { name: "name", label: "Full name", required: true }, { name: "email", label: "Email", type: "email" as const, required: true, disabled: () => !!form.edit },
    { name: "role", label: "Role", type: "select" as const, required: true, options: ROLES, col: 12 },
    ...(!form.edit ? [{ name: "password", label: "Temporary password", type: "password" as const, required: true, hint: "Min 10 characters, upper + lower case and a number" }] : [{ name: "active", label: "Account active", type: "checkbox" as const }]),
  ];
  return (
    <>
      <PageHeader title="Users & Access" subtitle="Role-based access with company-level permissions, enforced in the API and in the database"
        actions={<Button onClick={() => setForm({ show: true })}><i className="ti ti-user-plus me-1" />Add user</Button>} />
      <SectionCard flush>
        <DataTable rows={users} cols={[
          { key: "name", header: "User", render: (u: any) => <><div className="fw-semibold">{u.name}</div><div className="small text-secondary">{u.email}</div></> },
          { key: "role", header: "Role", render: (u: any) => <Badge bg="primary-subtle" text="primary-emphasis">{u.role.replace("_", " ")}</Badge> },
          { key: "cos", header: "Companies", render: (u: any) => (u.role === "SUPER_ADMIN" ? <span className="text-secondary">All companies</span> : u.company_ids.map((id: number) => meta!.companies.find((c) => c.id === id)?.name).filter(Boolean).join(", ") || "—") },
          { key: "last", header: "Last sign-in", hideMobile: true, render: (u: any) => fmtTs(u.last_login) },
          { key: "act", header: "Status", render: (u: any) => <Badge bg={u.active ? "success-subtle" : "secondary-subtle"} text={u.active ? "success-emphasis" : "secondary-emphasis"}>{u.active ? "Active" : "Disabled"}</Badge> },
          { key: "a", header: "", align: "end", render: (u: any) => <div className="d-flex gap-1 justify-content-end"><Button size="sm" variant="light" onClick={() => setForm({ show: true, edit: u })}><i className="ti ti-edit" /></Button><Button size="sm" variant="light" onClick={() => { setPw(u); setPwv(""); setErr(""); }}><i className="ti ti-key" /></Button></div> },
        ]} />
      </SectionCard>
      <SectionCard title="What each role can do">
        <Table size="sm" className="mb-0"><thead><tr><th>Capability</th>{ROLES.map((r) => <th key={r.value} className="text-center">{r.value.replace("_", " ")}</th>)}</tr></thead>
          <tbody>{PERMS.map(([t, , v]) => <tr key={t}><td>{t}</td>{v.map((x, i) => <td key={i} className="text-center">{x ? <i className="ti ti-check text-success" /> : <i className="ti ti-minus text-secondary" />}</td>)}</tr>)}</tbody></Table>
      </SectionCard>

      <FormModal show={form.show} title={form.edit ? `Edit ${form.edit.name}` : "Add user"} fields={fields} onClose={() => setForm({ show: false })} initial={form.edit ? { ...form.edit, company_ids: form.edit.company_ids } : { role: "ACCOUNTANT", company_ids: [] }}
        onSubmit={async (v) => { const body = { name: v.name, email: v.email, role: v.role, password: v.password, active: v.active, company_ids: v.company_ids || [] }; form.edit ? await api(`/users/${form.edit.id}`, { method: "PUT", body }) : await api("/users", { body }); toast("User saved"); setForm({ show: false }); reload(); }}>
        {(v, set) => v.role !== "SUPER_ADMIN" && (
          <div className="mt-3"><Form.Label className="small fw-semibold">Company access</Form.Label>
            <div className="d-flex flex-wrap gap-3">{meta!.companies.map((c) => <Form.Check key={c.id} type="checkbox" id={`co-${c.id}`} label={c.name} checked={(v.company_ids || []).includes(c.id)} onChange={(e) => set("company_ids", e.target.checked ? [...(v.company_ids || []), c.id] : (v.company_ids || []).filter((x: number) => x !== c.id))} />)}</div>
            <Form.Text className="text-secondary">Users only ever see data of the companies ticked here.</Form.Text></div>
        )}
      </FormModal>
      <Modal show={!!pw} onHide={() => setPw(null)} centered size="sm"><Modal.Header closeButton><Modal.Title className="fs-5">Reset password · {pw?.name}</Modal.Title></Modal.Header>
        <Modal.Body><Form.Control type="password" placeholder="New password" value={pwv} onChange={(e) => setPwv(e.target.value)} autoComplete="new-password" />{err && <div className="alert alert-danger py-2 mt-3 mb-0 small">{err}</div>}<div className="small text-secondary mt-2">All of the user&apos;s sessions are signed out.</div></Modal.Body>
        <Modal.Footer><Button variant="light" onClick={() => setPw(null)}>Cancel</Button><Button onClick={async () => { try { await api(`/users/${pw.id}/password`, { body: { password: pwv } }); toast("Password reset"); setPw(null); } catch (e: any) { setErr(e.message); } }}>Reset</Button></Modal.Footer></Modal>
    </>
  );
}
