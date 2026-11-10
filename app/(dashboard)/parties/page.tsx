"use client";
import { useState } from "react";
import { Button, Form, Modal, Tab, Tabs } from "react-bootstrap";
import { useApp, useQuery } from "components/erp/AppProvider";
import { DataTable, FieldDef, FormModal, Money, PageHeader, ReasonModal, SectionCard, Status } from "components/erp/ui";
import { api, fmtDate, inr } from "lib/client";

function Parties({ kind }: { kind: "customers" | "vendors" }) {
  const { meta, company, can, toast, reload: reloadMeta } = useApp();
  const isC = kind === "customers";
  const [page, setPage] = useState(1); const [q, setQ] = useState("");
  const { data, loading, reload } = useQuery<any>(`/${kind}`, { page, q }, { scoped: true, range: false });
  const [edit, setEdit] = useState<any>(null); const [show, setShow] = useState(false); const [stmt, setStmt] = useState<any>(null); const [rm, setRm] = useState<any>(null);
  const write = can("master.write"); const mine = meta!.companies.filter((c) => meta!.user.companyIds.includes(c.id));
  const fields: FieldDef[] = [
    { name: "company_id", label: "Company", type: "select", required: true, options: mine.map((c) => ({ value: c.id, label: c.name })), disabled: () => !!edit },
    { name: "name", label: isC ? "Customer name" : "Vendor name", required: true },
    { name: "email", label: "Email", type: "email" }, { name: "phone", label: "Phone" },
    { name: "gstin", label: "GSTIN" }, ...(!isC ? [{ name: "pan", label: "PAN" } as FieldDef] : []),
    { name: "state_code", label: "State code (e.g. 36)", hint: "Decides CGST+SGST vs IGST on invoices" }, { name: "credit_days", label: "Credit days", type: "number" },
    { name: "address", label: "Address", type: "textarea", col: 12 },
  ];
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between gap-2 mb-4">
        <Form.Control size="sm" placeholder="Search by name…" style={{ maxWidth: 280 }} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        {write && <Button onClick={() => { setEdit(null); setShow(true); }}><i className="ti ti-plus me-1" />Add {isC ? "customer" : "vendor"}</Button>}
      </div>
      <SectionCard flush>
        <DataTable rows={data?.rows?.filter((r: any) => r.active)} loading={loading} page={page} pageSize={data?.pageSize} total={data?.total} onPage={setPage}
          cols={[
            { key: "name", header: "Name", render: (r: any) => <span className="fw-semibold">{r.name}</span> },
            ...(company === "all" ? [{ key: "company_name", header: "Company", hideMobile: true } as any] : []),
            { key: "contact", header: "Contact", hideMobile: true, render: (r: any) => <>{r.email || "—"}<div className="small text-secondary">{r.phone}</div></> },
            { key: "gstin", header: "GSTIN", hideMobile: true }, { key: "credit_days", header: "Credit", render: (r: any) => `${r.credit_days} days` },
            { key: "a", header: "", align: "end", render: (r: any) => <div className="d-flex gap-1 justify-content-end">
              <Button size="sm" variant="light" onClick={async () => setStmt({ r, rows: await api(`/${kind}/${r.id}/statement`) })}>Statement</Button>
              {write && <Button size="sm" variant="light" onClick={() => { setEdit(r); setShow(true); }}><i className="ti ti-edit" /></Button>}
              {write && <Button size="sm" variant="light" className="text-danger" onClick={() => setRm(r)}><i className="ti ti-archive" /></Button>}</div> },
          ]} />
      </SectionCard>
      <FormModal show={show} title={edit ? `Edit ${edit.name}` : `Add ${isC ? "customer" : "vendor"}`} fields={fields} initial={edit || { company_id: company !== "all" ? company : mine.length === 1 ? mine[0].id : "", credit_days: 15 }} onClose={() => setShow(false)}
        onSubmit={async (v) => { const body = { ...v, company_id: +v.company_id, credit_days: Number(v.credit_days || 0) }; edit ? await api(`/${kind}/${edit.id}`, { method: "PUT", body }) : await api(`/${kind}`, { body }); toast("Saved"); setShow(false); reload(); reloadMeta(); }} />
      <ReasonModal show={!!rm} needReason={false} title={`Archive ${rm?.name}?`} message="The record is hidden from new documents but its invoices/bills and history stay intact." confirmLabel="Archive" onConfirm={async () => { await api(`/${kind}/${rm.id}`, { method: "DELETE" }); toast("Archived"); setRm(null); reload(); reloadMeta(); }} onClose={() => setRm(null)} />
      <Modal show={!!stmt} onHide={() => setStmt(null)} size="lg" centered scrollable>
        <Modal.Header closeButton><Modal.Title className="fs-5">{stmt?.r.name} · statement</Modal.Title></Modal.Header>
        <Modal.Body className="p-0">
          <DataTable dense rows={stmt?.rows} empty="No documents yet" cols={[{ key: "invoice_no", header: "Number" }, { key: "issue_date", header: "Date", render: (r: any) => fmtDate(r.issue_date) }, { key: "due_date", header: "Due", render: (r: any) => fmtDate(r.due_date) }, { key: "total", header: "Amount", align: "end", render: (r: any) => <Money v={r.total} /> }, { key: "amount_paid", header: isC ? "Received" : "Paid", align: "end", render: (r: any) => <Money v={r.amount_paid} /> }, { key: "balance", header: "Balance", align: "end", render: (r: any) => <Money v={r.status === "voided" ? 0 : r.balance} bold /> }, { key: "status", header: "Status", render: (r: any) => <Status value={r.status} /> }]} />
          {stmt && <div className="p-4 text-end fw-semibold">Outstanding: {inr(stmt.rows.filter((r: any) => !["voided", "paid"].includes(r.status)).reduce((s: number, r: any) => s + r.balance, 0))}</div>}
        </Modal.Body>
      </Modal>
    </>
  );
}

export default function PartiesPage() {
  return (
    <>
      <PageHeader title="Customers & Vendors" subtitle="Each company keeps its own customer and supplier master" />
      <Tabs defaultActiveKey="customers" className="mb-4" mountOnEnter>
        <Tab eventKey="customers" title="Customers"><Parties kind="customers" /></Tab>
        <Tab eventKey="vendors" title="Vendors & suppliers"><Parties kind="vendors" /></Tab>
      </Tabs>
    </>
  );
}
