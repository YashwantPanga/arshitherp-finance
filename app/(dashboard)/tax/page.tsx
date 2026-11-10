"use client";
import { useState } from "react";
import { Alert, Button, Col, Dropdown, Row, Tab, Tabs } from "react-bootstrap";
import { useApp, useQuery } from "components/erp/AppProvider";
import { DataTable, DateFilter, FormModal, Money, PageHeader, ReasonModal, SectionCard, StatCard, Status } from "components/erp/ui";
import { api, fmtDate, fmtTs, inr, qs, inr0 } from "lib/client";

const KINDS = [
  { value: "gst_payment", label: "GST payment to government (challan)" }, { value: "itc_setoff", label: "Input tax credit set-off" },
  { value: "tds_payment", label: "TDS deposit to government" }, { value: "tds_certificate", label: "TDS certificate received (register only)" },
];

export default function Tax() {
  const { meta, company, scope, can, toast, companyName } = useApp();
  const { data: rep, loading } = useQuery<any>("/reports/tax");
  const { data: recs, reload } = useQuery<any[]>("/tax-records", {}, { scoped: true, range: false });
  const [show, setShow] = useState(false); const [voiding, setVoiding] = useState<any>(null);
  const write = can("tax.write"); const mine = meta!.companies.filter((c) => meta!.user.companyIds.includes(c.id));
  const tot = (label: string) => rep?.rows.find((r: any) => r.label?.startsWith(label))?.total ?? 0;
  const exportUrl = (f: string) => `/api/reports/tax/export${qs({ ...scope, format: f })}`;
  return (
    <>
      <PageHeader title="GST & Tax" subtitle={`${companyName} · Indian financial year (April – March) · configurable, accountant-verified`}
        actions={<><DateFilter compact /><Dropdown align="end"><Dropdown.Toggle variant="light" size="sm"><i className="ti ti-download me-1" />Export</Dropdown.Toggle><Dropdown.Menu>{["xlsx", "pdf", "csv"].map((f) => <Dropdown.Item key={f} href={exportUrl(f)}>{f.toUpperCase()}</Dropdown.Item>)}</Dropdown.Menu></Dropdown>{write && <Button onClick={() => setShow(true)}><i className="ti ti-plus me-1" />Record tax payment</Button>}</>} />
      <Alert variant="warning" className="small"><i className="ti ti-info-circle me-1" /><strong>Not a filing system.</strong> This module computes GST/TDS positions from your ledger and keeps payment records. It does <u>not</u> file GST returns or integrate with the GST portal — your accountant must verify and file.</Alert>
      <Row className="g-4 mb-6">
        <Col xl={3} md={6}><StatCard title="Output GST" tone={3} icon="ti-arrow-up-right" value={inr0(tot("Total Output GST"))} sub="Collected on sales (period)" loading={loading} /></Col>
        <Col xl={3} md={6}><StatCard title="Input tax credit" tone={0} icon="ti-arrow-down-left" value={inr0(tot("Total Input Tax Credit"))} sub="Paid on purchases (period)" loading={loading} /></Col>
        <Col xl={3} md={6}><StatCard title="Net GST payable" tone={2} icon="ti-scale" value={inr0(tot("Net GST payable"))} sub="Output − input credit" loading={loading} /></Col>
        <Col xl={3} md={6}><StatCard title="TDS payable (closing)" tone={1} icon="ti-receipt-tax" value={inr0(tot("TDS payable"))} sub="Deducted, not yet deposited" loading={loading} /></Col>
      </Row>
      <Tabs defaultActiveKey="summary" className="mb-4">
        <Tab eventKey="summary" title="Tax summary">
          <SectionCard flush>
            <div className="table-responsive"><table className="table table-sm align-middle mb-0"><thead><tr>{rep?.columns.map((c: any) => <th key={c.key} className={c.kind === "money" ? "text-end" : ""}>{c.label}</th>)}</tr></thead>
              <tbody>{rep?.rows.map((r: any, i: number) => <tr key={i} className={r._style === "grand" ? "table-active" : r._style === "head" ? "bg-body-tertiary" : ""}>{rep.columns.map((c: any, ci: number) => <td key={c.key} className={`${c.kind === "money" ? "text-end" : ""} ${["total", "grand", "sub", "head"].includes(r._style) ? "fw-semibold" : ""}`} style={{ paddingLeft: ci === 0 && r._level ? 12 + r._level * 18 : undefined }}>{r._style === "head" && ci > 0 ? "" : c.kind === "money" ? inr(r[c.key]) : r[c.key]}</td>)}</tr>)}</tbody></table></div>
          </SectionCard>
        </Tab>
        <Tab eventKey="records" title="Tax payments & records">
          <SectionCard flush>
            <DataTable rows={recs} empty="No tax records yet" cols={[
              { key: "d", header: "Date", render: (r: any) => fmtDate(r.record_date) }, { key: "company_name", header: "Company", hideMobile: true },
              { key: "kind", header: "Type", render: (r: any) => KINDS.find((k) => k.value === r.kind)?.label.split(" (")[0] }, { key: "period", header: "Period", hideMobile: true },
              { key: "split", header: "CGST / SGST / IGST", hideMobile: true, render: (r: any) => (r.kind.startsWith("gst") || r.kind === "itc_setoff" ? `${inr(r.cgst)} / ${inr(r.sgst)} / ${inr(r.igst)}` : "—") },
              { key: "amount", header: "Amount", align: "end", render: (r: any) => <Money v={r.amount} bold /> }, { key: "reference", header: "Reference", hideMobile: true },
              { key: "ver", header: "Verified", render: (r: any) => (r.verified_at ? <span className="text-success small"><i className="ti ti-circle-check" /> {r.verified_by_name}<div className="text-secondary">{fmtTs(r.verified_at)}</div></span> : write && r.status === "posted" ? <Button size="sm" variant="light" onClick={async () => { await api(`/tax-records/${r.id}/verify`, { body: {} }); toast("Marked as verified"); reload(); }}>Verify</Button> : "—") },
              { key: "st", header: "Status", render: (r: any) => <Status value={r.status} /> },
              { key: "a", header: "", render: (r: any) => write && r.status === "posted" && <Button size="sm" variant="light" className="text-danger" onClick={() => setVoiding(r)}>Void</Button> },
            ]} />
          </SectionCard>
        </Tab>
        <Tab eventKey="reg" title="GST registration">
          <Row className="g-4">
            {meta!.companies.filter((c) => company === "all" || String(c.id) === company).map((c) => (
              <Col md={4} key={c.id}><div className="card h-100"><div className="card-body">
                <div className="fw-semibold mb-2">{c.name}</div>
                <div className="small text-secondary">GST registered</div><div className="mb-2">{c.gst_registered ? "Yes" : "No"}</div>
                <div className="small text-secondary">GSTIN</div><div className="mb-2">{c.gstin || "— not set"}</div>
                <div className="small text-secondary">PAN</div><div className="mb-2">{c.pan || "—"}</div>
                <div className="small text-secondary">State / code</div><div>{c.state || "—"} {c.state_code && `(${c.state_code})`}</div>
              </div></div></Col>
            ))}
          </Row>
          <div className="small text-secondary mt-3">Edit registration details in Settings → Company profile. Intra-state sales use CGST + SGST, inter-state use IGST (decided by customer state code).</div>
        </Tab>
      </Tabs>
      <FormModal show={show} title="Record tax payment / adjustment" onClose={() => setShow(false)} initial={{ company_id: company !== "all" ? company : mine.length === 1 ? mine[0].id : "", kind: "gst_payment", record_date: meta!.today, cgst: "", sgst: "", igst: "", amount: "" }}
        fields={[
          { name: "company_id", label: "Company", type: "select", required: true, options: mine.map((c) => ({ value: c.id, label: c.name })) },
          { name: "kind", label: "Record type", type: "select", required: true, options: KINDS }, { name: "record_date", label: "Date", type: "date", required: true }, { name: "period", label: "Tax period", placeholder: "2026-10" },
          { name: "cgst", label: "CGST", type: "money", col: 4, show: (v) => ["gst_payment", "itc_setoff"].includes(v.kind) }, { name: "sgst", label: "SGST", type: "money", col: 4, show: (v) => ["gst_payment", "itc_setoff"].includes(v.kind) }, { name: "igst", label: "IGST", type: "money", col: 4, show: (v) => ["gst_payment", "itc_setoff"].includes(v.kind) },
          { name: "amount", label: "Amount", type: "money", show: (v) => !["gst_payment", "itc_setoff"].includes(v.kind) },
          { name: "bank_account_id", label: "Paid from", type: "select", show: (v) => ["gst_payment", "tds_payment"].includes(v.kind), options: (v) => meta!.banks.filter((b) => String(b.company_id) === String(v.company_id) && b.active).map((b) => ({ value: b.id, label: b.name })) },
          { name: "reference", label: "Challan / reference no." }, { name: "notes", label: "Notes", type: "textarea", col: 12 },
        ]}
        transform={(o, k, val) => (k === "company_id" ? { ...o, company_id: val, bank_account_id: "" } : { ...o, [k]: val })}
        onSubmit={async (v) => { await api("/tax-records", { body: { ...v, company_id: +v.company_id, cgst: Number(v.cgst || 0), sgst: Number(v.sgst || 0), igst: Number(v.igst || 0), amount: Number(v.amount || 0), bank_account_id: v.bank_account_id ? +v.bank_account_id : null } }); toast("Recorded and posted to the ledger"); setShow(false); reload(); }}>
        {() => <div className="alert alert-info py-2 mt-3 mb-0 small">Payments reduce the GST/TDS liability and your bank balance. They are not expenses. Statutory deadlines and filing remain your accountant&apos;s responsibility.</div>}
      </FormModal>
      <ReasonModal show={!!voiding} title="Void tax record" message="The ledger entry is reversed." confirmLabel="Void" onConfirm={async (reason) => { await api(`/tax-records/${voiding.id}/void`, { body: { reason } }); toast("Voided"); setVoiding(null); reload(); }} onClose={() => setVoiding(null)} />
    </>
  );
}
