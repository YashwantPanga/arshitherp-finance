"use client";
import { useState } from "react";
import { Button, Col, Form, ProgressBar, Row } from "react-bootstrap";
import { useApp, useQuery } from "components/erp/AppProvider";
import { DataTable, FormModal, Money, PageHeader, ReasonModal, SectionCard, StatCard } from "components/erp/ui";
import { api, inr, inr0 } from "lib/client";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function Budgets() {
  const { meta, company, can, toast, companyName } = useApp();
  const [fy, setFy] = useState(meta!.fy);
  const { data: r, loading, reload } = useQuery<any>("/reports/budget-vs-actual", { fy }, { scoped: true, range: false });
  const { data: raw } = useQuery<any[]>("/budgets", { fy }, { scoped: true, range: false });
  const [show, setShow] = useState(false); const [del, setDel] = useState<any>(null);
  const write = can("budget.write"); const mine = meta!.companies.filter((c) => meta!.user.companyIds.includes(c.id));
  const rows: any[] = r?.rows || [];
  const T = (k: string) => rows.reduce((s, x) => s + x[k], 0);
  const over = rows.filter((x) => x.utilization > 100);
  return (
    <>
      <PageHeader title="Budgets" subtitle={`${companyName} · Allocated vs actual spending for FY ${fy}`}
        actions={<><Form.Select size="sm" style={{ width: 130 }} value={fy} onChange={(e) => setFy(e.target.value)}>{["2025-26", "2026-27", "2027-28"].map((f) => <option key={f}>{f}</option>)}</Form.Select>{write && <Button onClick={() => setShow(true)}><i className="ti ti-plus me-1" />Add budget</Button>}</>} />
      {over.length > 0 && <div className="alert alert-danger"><i className="ti ti-alert-triangle me-2" /><strong>{over.length} budget line(s) exceeded:</strong> {over.map((o) => `${o.company} · ${o.category} (${o.utilization.toFixed(0)}%)`).join(", ")}</div>}
      <Row className="g-4 mb-6">
        <Col md={3}><StatCard title="Budget allocated" tone={1} icon="ti-wallet" value={inr0(T("budget"))} loading={!r} /></Col>
        <Col md={3}><StatCard title="Actual spending" tone={3} icon="ti-credit-card" value={inr0(T("actual"))} loading={!r} /></Col>
        <Col md={3}><StatCard title="Remaining" tone={0} icon="ti-piggy-bank" value={inr0(T("remaining"))} loading={!r} /></Col>
        <Col md={3}><StatCard title="Utilisation" tone={2} icon="ti-gauge" value={`${T("budget") ? ((T("actual") / T("budget")) * 100).toFixed(1) : 0}%`} loading={!r} /></Col>
      </Row>
      <SectionCard flush>
        <DataTable rows={rows} loading={loading} empty="No budgets for this year yet" cols={[
          { key: "company", header: "Company", hideMobile: true }, { key: "category", header: "Category", render: (x: any) => <span className="fw-semibold">{x.category}</span> }, { key: "department", header: "Dept", hideMobile: true }, { key: "period", header: "Period" },
          { key: "budget", header: "Budget", align: "end", render: (x: any) => <Money v={x.budget} /> }, { key: "actual", header: "Actual", align: "end", render: (x: any) => <Money v={x.actual} /> }, { key: "remaining", header: "Remaining", align: "end", render: (x: any) => <Money v={x.remaining} bold /> },
          { key: "util", header: "Utilisation", width: 190, render: (x: any) => <div><ProgressBar now={Math.min(100, x.utilization)} variant={x.utilization > 100 ? "danger" : x.utilization >= 90 ? "warning" : "success"} style={{ height: 6 }} /><div className={`small mt-1 ${x.utilization > 100 ? "text-danger fw-semibold" : "text-secondary"}`}>{x.utilization.toFixed(1)}% · {x.status}</div></div> },
          { key: "a", header: "", align: "end", render: (x: any) => write && <Button size="sm" variant="light" className="text-danger" onClick={() => setDel(x)}><i className="ti ti-trash" /></Button> },
        ]} />
      </SectionCard>
      <FormModal show={show} title="Add or update a budget" onClose={() => setShow(false)} initial={{ company_id: company !== "all" ? company : mine.length === 1 ? mine[0].id : "", fy, department: "", month: "" }}
        fields={[
          { name: "company_id", label: "Company", type: "select", required: true, options: mine.map((c) => ({ value: c.id, label: c.name })) },
          { name: "fy", label: "Financial year", type: "select", required: true, options: ["2025-26", "2026-27", "2027-28"].map((f) => ({ value: f, label: f })) },
          { name: "category_id", label: "Expense category", type: "select", required: true, options: (v) => meta!.categories.filter((c) => c.kind === "expense" && String(c.company_id) === String(v.company_id)).map((c) => ({ value: c.id, label: c.name })) },
          { name: "department", label: "Department" },
          { name: "month", label: "Period", type: "select", options: MONTHS.map((m, i) => ({ value: i + 1, label: m })), hint: "Leave empty for a full-year budget" },
          { name: "amount", label: "Budget amount", type: "money", required: true },
        ]}
        transform={(o, k, val) => (k === "company_id" ? { ...o, company_id: val, category_id: "" } : { ...o, [k]: val })}
        onSubmit={async (v) => { await api("/budgets", { body: { ...v, company_id: +v.company_id, category_id: +v.category_id, month: v.month ? +v.month : null, amount: Number(v.amount) } }); toast("Budget saved"); setShow(false); reload(); }} />
      <ReasonModal show={!!del} needReason={false} title="Delete this budget line?" message={del && `${del.company} · ${del.category} · ${del.period}`} confirmLabel="Delete" onConfirm={async () => { const b = raw?.find((x: any) => x.id === del.id); await api(`/budgets/${b?.id ?? del.id}`, { method: "DELETE" }); toast("Deleted"); setDel(null); reload(); }} onClose={() => setDel(null)} />
    </>
  );
}
