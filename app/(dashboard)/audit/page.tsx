"use client";
import { useState } from "react";
import { Badge, Form, Modal } from "react-bootstrap";
import { useApp, useQuery } from "components/erp/AppProvider";
import { DataTable, PageHeader, SectionCard } from "components/erp/ui";
import { fmtTs } from "lib/client";

const ACTION_COLOR: Record<string, string> = { create: "success", update: "info", void: "danger", approve: "success", reject: "danger", post: "primary", issue: "primary", export: "secondary", login: "secondary", login_failed: "danger", delete_draft: "warning", opening_adjustment: "warning" };

export default function Audit() {
  const { companyName } = useApp();
  const [page, setPage] = useState(1); const [entity, setEntity] = useState(""); const [action, setAction] = useState(""); const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const { data, loading } = useQuery<any>("/audit", { page, entity, action, q, from, to }, { scoped: true, range: false });
  const [sel, setSel] = useState<any>(null);
  return (
    <>
      <PageHeader title="Audit Log" subtitle={`${companyName} · Append-only: who changed what, with before/after values, approvals and voids`} />
      <SectionCard flush>
        <div className="d-flex flex-wrap gap-2 p-4 border-bottom">
          <Form.Control size="sm" placeholder="Search user, note or record id…" style={{ maxWidth: 260 }} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Form.Select size="sm" style={{ width: 160 }} value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}><option value="">All records</option>{["transaction", "invoice", "bill", "payment", "payroll", "payroll_item", "tax_record", "bank_account", "budget", "company", "user", "report", "category", "customers", "vendors", "employees", "financial_period"].map((x) => <option key={x}>{x}</option>)}</Form.Select>
          <Form.Select size="sm" style={{ width: 150 }} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}><option value="">All actions</option>{Object.keys(ACTION_COLOR).map((x) => <option key={x}>{x}</option>)}</Form.Select>
          <Form.Control size="sm" type="date" style={{ width: 140 }} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From" />
          <Form.Control size="sm" type="date" style={{ width: 140 }} value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To" />
        </div>
        <DataTable rows={data?.rows} loading={loading} page={page} pageSize={data?.pageSize} total={data?.total} onPage={setPage} onRow={setSel} dense
          cols={[
            { key: "ts", header: "When", render: (r: any) => <span className="text-nowrap">{fmtTs(r.ts)}</span> }, { key: "user_email", header: "User", render: (r: any) => r.user_email || "system" },
            { key: "company_name", header: "Company", hideMobile: true, render: (r: any) => r.company_name || "—" },
            { key: "action", header: "Action", render: (r: any) => <Badge bg={`${ACTION_COLOR[r.action] || "secondary"}-subtle`} text={`${ACTION_COLOR[r.action] || "secondary"}-emphasis`}>{r.action}</Badge> },
            { key: "entity", header: "Record", render: (r: any) => `${r.entity_type}${r.entity_id ? " #" + r.entity_id : ""}` }, { key: "note", header: "Note", hideMobile: true },
            { key: "d", header: "", render: (r: any) => (r.before || r.after ? <i className="ti ti-eye text-secondary" /> : "") },
          ]} />
      </SectionCard>
      <Modal show={!!sel} onHide={() => setSel(null)} size="lg" centered scrollable>
        {sel && <><Modal.Header closeButton><Modal.Title className="fs-5">{sel.action} · {sel.entity_type} {sel.entity_id}</Modal.Title></Modal.Header>
          <Modal.Body>
            <div className="small text-secondary mb-3">{fmtTs(sel.ts)} · {sel.user_email || "system"} · IP {sel.ip || "—"}{sel.note && ` · ${sel.note}`}</div>
            <div className="row g-3">
              {[["Previous values", sel.before], ["Updated values", sel.after]].map(([t, v]: any) => <div className="col-md-6" key={t}><div className="fw-semibold small mb-1">{t}</div><pre className="bg-body-tertiary rounded-3 p-3 small mb-0" style={{ maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap" }}>{v ? JSON.stringify(v, null, 2) : "—"}</pre></div>)}
            </div>
          </Modal.Body></>}
      </Modal>
    </>
  );
}
