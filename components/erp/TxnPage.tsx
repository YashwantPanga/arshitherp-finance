"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Col, Dropdown, Form, Modal, Row } from "react-bootstrap";
import { useApp, useQuery } from "./AppProvider";
import { Chart, DataTable, DateFilter, FieldDef, FormModal, Loading, Money, PageHeader, PALETTE, ReasonModal, SectionCard, StatCard, Status } from "./ui";
import { api, fmtDate, fmtTs, inr, inrShort, qs, inr0 } from "lib/client";

const METHODS = ["Cash", "Bank transfer", "UPI", "Card", "Cheque", "Gateway", "Other"].map((m) => ({ value: m, label: m }));

export default function TxnPage({ kind }: { kind: "income" | "expense" }) {
  const isInc = kind === "income";
  const { meta, company, scope, can, toast, companyName } = useApp();
  const sp = useSearchParams();
  const [page, setPage] = useState(1); const [q, setQ] = useState(""); const [status, setStatus] = useState(sp.get("status") || ""); const [category, setCategory] = useState(""); const [method, setMethod] = useState("");
  const params = { kind, page, q, status, category, method, withCategories: 1 };
  const { data, loading, reload, error } = useQuery<any>("/transactions", params);
  const [edit, setEdit] = useState<any | null>(null); const [show, setShow] = useState(false);
  const [voiding, setVoiding] = useState<any | null>(null); const [detail, setDetail] = useState<any | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const writable = can("txn.write"); const approver = can("txn.approve");
  const myCompanies = meta!.companies.filter((c) => meta!.user.companyIds.includes(c.id));
  const cats = meta!.categories.filter((c) => c.kind === kind && c.active);

  const fields: FieldDef[] = useMemo(() => [
    { name: "company_id", label: "Company", type: "select", required: true, options: myCompanies.map((c) => ({ value: c.id, label: c.name })), disabled: (v) => !!v.id },
    { name: "txn_date", label: isInc ? "Transaction date" : "Payment date", type: "date", required: true },
    { name: "category_id", label: isInc ? "Income category" : "Expense category", type: "select", required: true, options: (v) => cats.filter((c) => String(c.company_id) === String(v.company_id)).map((c) => ({ value: c.id, label: c.name })) },
    isInc
      ? { name: "customer_id", label: "Customer", type: "select", options: (v) => meta!.customers.filter((c) => String(c.company_id) === String(v.company_id)).map((c) => ({ value: c.id, label: c.name })) }
      : { name: "vendor_id", label: "Vendor", type: "select", options: (v) => meta!.vendors.filter((c) => String(c.company_id) === String(v.company_id)).map((c) => ({ value: c.id, label: c.name })) },
    { name: "party_name", label: isInc ? "Customer name (if not listed)" : "Payee name (if not listed)" },
    ...(isInc ? [{ name: "invoice_no", label: "Invoice number" } as FieldDef] : []),
    { name: "base_amount", label: isInc ? "Amount (excl. GST)" : "Amount (excl. GST)", type: "money", required: true },
    { name: "tax_amount", label: isInc ? "GST amount" : "GST amount (input credit)", type: "money", hint: "Posted to the GST ledger, not to revenue/expense", show: (v) => !!meta!.companies.find((c) => String(c.id) === String(v.company_id))?.gst_registered },
    { name: "tax_type", label: "GST type", type: "select", options: [{ value: "GST", label: "CGST + SGST (intra-state)" }, { value: "IGST", label: "IGST (inter-state)" }], show: (v) => Number(v.tax_amount) > 0 },
    ...(!isInc ? [{ name: "tds_amount", label: "TDS deducted", type: "money", hint: "Withheld from payee, owed to government", col: 6 } as FieldDef] : []),
    { name: "bank_account_id", label: isInc ? "Deposited to" : "Paid from", type: "select", required: true, options: (v) => meta!.banks.filter((b) => String(b.company_id) === String(v.company_id) && b.active).map((b) => ({ value: b.id, label: `${b.name} (${inr(b.balance)})` })) },
    { name: "payment_method", label: "Payment method", type: "select", options: METHODS },
    { name: "reference", label: isInc ? "Payment reference / UTR" : "Reference / invoice no." },
    { name: "project", label: isInc ? "Product / project / course" : "Project / department", hint: "Used for product-wise, project-wise or course-wise reporting" },
    ...(isInc ? [{ name: "payment_status", label: "Payment status", type: "select", options: [{ value: "received", label: "Received (post now)" }, { value: "pending", label: "Pending (keep as draft)" }] } as FieldDef] : [{ name: "recurring", label: "Recurring", type: "select", options: [{ value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "yearly", label: "Yearly" }] } as FieldDef]),
    { name: "description", label: isInc ? "Description" : "Notes", type: "textarea", col: 12 },
  ], [meta, isInc]); // eslint-disable-line react-hooks/exhaustive-deps

  const blank = () => ({ company_id: company !== "all" ? company : myCompanies.length === 1 ? myCompanies[0].id : "", txn_date: meta!.today, tax_type: "GST", payment_status: "received", base_amount: "", tax_amount: "", tds_amount: "" });
  const openNew = () => { setEdit(null); setFile(null); setShow(true); };
  const openEdit = async (r: any) => { const d = await api(`/transactions/${r.id}`); setEdit({ ...d, base_amount: +(d.amount - d.tax_amount).toFixed(2), payment_status: d.payment_status === "pending" ? "pending" : "received" }); setFile(null); setShow(true); };

  const save = async (v: any) => {
    const body = { ...v, kind, category_id: +v.category_id, bank_account_id: +v.bank_account_id, company_id: +v.company_id, customer_id: v.customer_id ? +v.customer_id : null, vendor_id: v.vendor_id ? +v.vendor_id : null, base_amount: Number(v.base_amount), tax_amount: Number(v.tax_amount || 0), tds_amount: Number(v.tds_amount || 0), recurring: v.recurring || null };
    const row: any = edit ? await api(`/transactions/${edit.id}`, { method: "PUT", body }) : await api("/transactions", { body });
    if (file) { const f = new FormData(); f.append("file", file); f.append("entity_type", "transaction"); f.append("entity_id", String(row.id)); await api("/attachments", { form: f }); }
    toast(edit ? "Updated — ledger corrected with a reversal entry" : row.status === "pending_approval" ? "Saved — awaiting super admin approval" : row.status === "draft" ? "Saved as pending (not in the books yet)" : "Posted to the ledger");
    setShow(false); reload();
  };
  const act = async (path: string, msg: string, body: any = {}) => { try { await api(path, { body }); toast(msg); reload(); setDetail(null); } catch (e: any) { toast(e.message, "danger"); } };
  const exportUrl = (fmt: string) => `/api/transactions/export${qs({ ...scope, kind, q, status, category, method, format: fmt })}`;
  const s = data?.summary;
  const cols = [
    { key: "txn_date", header: "Date", render: (r: any) => fmtDate(r.txn_date) },
    { key: "txn_no", header: "Reference", hideMobile: true, render: (r: any) => <span className="text-secondary small">{r.txn_no}</span> },
    ...(company === "all" ? [{ key: "company_name", header: "Company", hideMobile: true } as any] : []),
    { key: "category", header: "Category" },
    { key: "party", header: isInc ? "Customer" : "Vendor / payee", render: (r: any) => r.party_name || r.customer_name || r.vendor_name || "—" },
    { key: "payment_method", header: "Method", hideMobile: true },
    { key: "amount", header: "Amount", align: "end" as const, render: (r: any) => <><Money v={r.amount} bold /><div className="text-secondary small">GST {inr(r.tax_amount)}</div></> },
    { key: "status", header: "Status", render: (r: any) => <><Status value={r.status === "draft" && isInc ? "pending" : r.status} />{r.recurring && <i className="ti ti-repeat ms-1 text-secondary" title={`Recurs ${r.recurring}`} />}{r.attachments > 0 && <i className="ti ti-paperclip ms-1 text-secondary" />}</> },
  ];

  return (
    <>
      <PageHeader
        title={isInc ? "Income" : "Expenses"}
        subtitle={`${companyName} · ${isInc ? "Money received, posted to revenue accounts" : "Money paid out, with approval workflow"}`}
        actions={<>
          <DateFilter compact />
          <Dropdown align="end"><Dropdown.Toggle variant="light" size="sm"><i className="ti ti-download me-1" />Export</Dropdown.Toggle>
            <Dropdown.Menu>{["xlsx", "pdf", "csv"].map((f) => <Dropdown.Item key={f} href={exportUrl(f)}>{f === "xlsx" ? "Excel (.xlsx)" : f === "pdf" ? "PDF" : "CSV"}</Dropdown.Item>)}</Dropdown.Menu></Dropdown>
          {!isInc && writable && <Button variant="light" size="sm" onClick={async () => { try { const r = await api<any>(`/transactions/run-recurring${qs({ company })}`, { body: {} }); toast(`${r.created} recurring expense(s) generated`); reload(); } catch (e: any) { toast(e.message, "danger"); } }}><i className="ti ti-repeat me-1" />Run recurring</Button>}
          {writable && <Button onClick={openNew}><i className="ti ti-plus me-1" />Add {isInc ? "income" : "expense"}</Button>}
        </>}
      />
      {error && <div className="alert alert-danger">{error}</div>}

      <Row className="g-4 mb-6">
        <Col xl={3} md={6}><StatCard title={isInc ? "Total income (posted)" : "Total expenses (posted)"} tone={isInc ? 0 : 3} icon={isInc ? "ti-arrow-down-left" : "ti-arrow-up-right"} value={inr0(s?.total)} sub={`${s?.n ?? 0} records`} loading={!s} /></Col>
        <Col xl={3} md={6}><StatCard title="GST included" tone={1} icon="ti-percentage" value={inr0(s?.tax)} sub={isInc ? "Output GST collected" : "Input GST credit"} loading={!s} /></Col>
        <Col xl={3} md={6}><StatCard title={isInc ? "Pending / draft" : "Awaiting approval"} tone={2} icon="ti-hourglass" value={inr0(s?.pending)} sub={`${s?.pending_n ?? 0} item(s)`} loading={!s} /></Col>
        <Col xl={3} md={6}><StatCard title={isInc ? "Top category" : "Highest category"} tone={0} icon="ti-chart-pie" value={data?.byCategory?.[0]?.name || "—"} sub={data?.byCategory?.[0] ? inr(data.byCategory[0].value) : ""} loading={!data} /></Col>
      </Row>

      <Row className="g-4 mb-6">
        <Col xl={7}>
          <SectionCard title={isInc ? "Monthly income" : "Monthly expense trend"} className="mb-0 h-100">
            {data?.monthly?.length ? <Chart type="area" height={240} series={[{ name: isInc ? "Income" : "Expenses", data: data.monthly.map((m: any) => m.value) }]} options={{ xaxis: { categories: data.monthly.map((m: any) => m.month) }, yaxis: { labels: { formatter: (v: number) => inrShort(v) } }, tooltip: { y: { formatter: (v: number) => inr(v) } }, colors: [isInc ? PALETTE[0] : PALETTE[4]], legend: { show: false }, fill: { type: "gradient", gradient: { opacityFrom: 0.35, opacityTo: 0.02 } } }} /> : <div className="text-secondary text-center py-8">No data for these filters</div>}
          </SectionCard>
        </Col>
        <Col xl={5}>
          <SectionCard title={isInc ? "By category" : "Category-wise expenses"} className="mb-0 h-100">
            {data?.byCategory?.length ? <Chart type="bar" height={240} series={[{ name: "Amount", data: data.byCategory.map((c: any) => c.value) }]} options={{ plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "60%", distributed: true } }, xaxis: { tickAmount: 3, categories: data.byCategory.map((c: any) => c.name), labels: { formatter: (v: any) => inrShort(Number(v)) } }, legend: { show: false }, tooltip: { y: { formatter: (v: number) => inr(v) } } }} /> : <div className="text-secondary text-center py-8">No data for these filters</div>}
          </SectionCard>
        </Col>
      </Row>

      <SectionCard flush>
        <div className="d-flex flex-wrap gap-2 p-4 border-bottom">
          <Form.Control size="sm" placeholder="Search party, reference, note…" style={{ maxWidth: 260 }} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Form.Select size="sm" style={{ width: 170 }} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">All categories</option>
            {[...new Map(cats.filter((c) => company === "all" || String(c.company_id) === company).map((c) => [c.company_id + c.name, c])).values()].map((c: any) => <option key={c.id} value={c.id}>{c.name}{company === "all" ? ` (${meta!.companies.find((x) => x.id === c.company_id)?.code})` : ""}</option>)}
          </Form.Select>
          <Form.Select size="sm" style={{ width: 160 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option><option value="posted">Posted</option><option value="pending_approval">Pending approval</option><option value="draft">Draft / pending</option><option value="voided">Voided</option>
          </Form.Select>
          <Form.Select size="sm" style={{ width: 150 }} value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }}>
            <option value="">All methods</option>{METHODS.map((m) => <option key={m.value}>{m.value}</option>)}
          </Form.Select>
        </div>
        <DataTable rows={data?.rows} loading={loading} cols={cols} onRow={async (r) => setDetail(await api(`/transactions/${r.id}`).then((d) => ({ ...d, category: r.category, company_name: r.company_name, bank_name: r.bank_name, created_by_name: r.created_by_name })))} page={page} pageSize={data?.pageSize} total={data?.total} onPage={setPage} empty={`No ${kind} records match these filters`} />
      </SectionCard>

      <FormModal show={show} title={edit ? `Edit ${isInc ? "income" : "expense"} · ${edit.txn_no}` : `New ${isInc ? "income" : "expense"}`} fields={fields} initial={edit || blank()} onSubmit={save} onClose={() => setShow(false)}
        transform={(o, k, val) => (k === "company_id" ? { ...o, company_id: val, category_id: "", bank_account_id: "", customer_id: "", vendor_id: "" } : { ...o, [k]: val })}
        submitLabel={edit?.status === "posted" ? "Save & re-post" : "Save"}>
        {() => (
          <div className="mt-3">
            <Form.Label className="small fw-semibold mb-1">Receipt / proof (PDF, PNG, JPG · max 5 MB)</Form.Label>
            <Form.Control type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] || null)} />
            {edit?.files?.length > 0 && <div className="mt-2 small">{edit.files.map((f: any) => <a key={f.id} className="me-3" href={`/api/attachments/${f.id}`} target="_blank"><i className="ti ti-paperclip" /> {f.filename}</a>)}</div>}
            {edit?.status === "posted" && <div className="alert alert-warning py-2 mt-3 mb-0 small">This entry is already posted. Saving reverses the old journal entry and posts a new one; both stay in the audit trail.</div>}
            {!isInc && !approver && <div className="alert alert-info py-2 mt-3 mb-0 small">Expenses you enter go to the super admin for approval before they affect profit.</div>}
          </div>
        )}
      </FormModal>

      <ReasonModal show={!!voiding} title={`Void ${voiding?.txn_no}`} message="The ledger entry is reversed (never deleted) and the record stays visible as voided." confirmLabel="Void transaction"
        onConfirm={async (reason) => { await api(`/transactions/${voiding.id}/void`, { body: { reason } }); toast("Voided and reversed"); setVoiding(null); setDetail(null); reload(); }} onClose={() => setVoiding(null)} />

      <Modal show={!!detail} onHide={() => setDetail(null)} size="lg" centered scrollable>
        {detail && (
          <>
            <Modal.Header closeButton><Modal.Title className="fs-5">{detail.txn_no} <Status value={detail.status === "draft" && isInc ? "pending" : detail.status} /></Modal.Title></Modal.Header>
            <Modal.Body>
              <Row className="g-3 mb-4">
                {[["Company", detail.company_name], ["Date", fmtDate(detail.txn_date)], ["Category", detail.category], ["Party", detail.party_name || "—"], ["Account", detail.bank_name], ["Method", detail.payment_method || "—"], ["Reference", detail.reference || "—"], ["Project", detail.project || "—"], ["Created by", detail.created_by_name || "—"]].map(([k, v]) => (
                  <Col md={4} key={k as string}><div className="text-secondary small">{k}</div><div className="fw-semibold">{v}</div></Col>
                ))}
                <Col md={4}><div className="text-secondary small">Amount</div><div className="fw-semibold">{inr(detail.amount - detail.tax_amount)}</div></Col>
                <Col md={4}><div className="text-secondary small">GST / TDS</div><div className="fw-semibold">{inr(detail.tax_amount)} / {inr(detail.tds_amount)}</div></Col>
                <Col md={4}><div className="text-secondary small">Total</div><div className="fw-semibold">{inr(detail.amount)}</div></Col>
              </Row>
              {detail.description && <p className="text-secondary">{detail.description}</p>}
              {detail.files?.map((f: any) => <a key={f.id} className="d-block small mb-1" href={`/api/attachments/${f.id}`} target="_blank"><i className="ti ti-paperclip" /> {f.filename}</a>)}
              {detail.void_reason && <div className="alert alert-secondary py-2 small">Voided: {detail.void_reason}</div>}
              <h3 className="fs-6 mt-4">History</h3>
              {detail.history ? <ul className="list-unstyled small mb-0">{detail.history.map((h: any, i: number) => <li key={i} className="py-1 border-bottom"><span className="text-secondary">{fmtTs(h.ts)}</span> · <strong>{h.action}</strong> by {h.user_email || "system"}{h.note ? ` — ${h.note}` : ""}</li>)}</ul> : <Loading />}
            </Modal.Body>
            <Modal.Footer className="flex-wrap">
              {detail.status === "pending_approval" && approver && <><Button variant="success" onClick={() => act(`/transactions/${detail.id}/approve`, "Approved and posted")}><i className="ti ti-check me-1" />Approve</Button><Button variant="outline-danger" onClick={() => act(`/transactions/${detail.id}/reject`, "Rejected", { note: "Rejected by approver" })}>Reject</Button></>}
              {detail.status === "draft" && writable && <><Button variant="success" onClick={() => act(`/transactions/${detail.id}/approve`, "Posted")}>{isInc ? "Mark received & post" : "Post"}</Button><Button variant="outline-danger" onClick={async () => { try { await api(`/transactions/${detail.id}`, { method: "DELETE" }); toast("Draft deleted"); setDetail(null); reload(); } catch (e: any) { toast(e.message, "danger"); } }}>Delete draft</Button></>}
              {detail.status !== "voided" && writable && <Button variant="light" onClick={() => { const d = detail; setDetail(null); openEdit(d); }}><i className="ti ti-edit me-1" />Edit</Button>}
              {detail.status !== "voided" && writable && <Button variant="outline-danger" onClick={() => setVoiding(detail)}><i className="ti ti-ban me-1" />Void</Button>}
              <Button variant="light" onClick={() => setDetail(null)}>Close</Button>
            </Modal.Footer>
          </>
        )}
      </Modal>
    </>
  );
}
