"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Col, Dropdown, Form, Modal, Row, Spinner } from "react-bootstrap";
import { useApp, useQuery } from "./AppProvider";
import { DataTable, DateFilter, Fields, FieldDef, Loading, Money, PageHeader, ReasonModal, SectionCard, StatCard, Status } from "./ui";
import { api, fmtDate, fmtTs, inr, qs, inr0 } from "lib/client";

const GST_RATES = [0, 5, 12, 18, 28];
const METHODS = ["Bank transfer", "UPI", "Cash", "Cheque", "Card", "Gateway"].map((m) => ({ value: m, label: m }));
const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export default function DocsPage({ kind }: { kind: "invoice" | "bill" }) {
  const isI = kind === "invoice";
  const { meta, company, scope, can, toast, companyName } = useApp();
  const sp = useSearchParams();
  const [page, setPage] = useState(1); const [q, setQ] = useState(""); const [status, setStatus] = useState(sp.get("status") || "");
  const base = isI ? "/invoices" : "/bills";
  const { data, loading, reload } = useQuery<any>(base, { page, q, status });
  const [form, setForm] = useState<{ open: boolean; doc?: any }>({ open: false });
  const [detailId, setDetailId] = useState<number | null>(null);
  const writable = can("invoice.write");
  const s = data?.summary;
  const exportUrl = (f: string) => `/api/reports/${isI ? "receivables" : "payables"}/export${qs({ ...scope, status, format: f })}`;

  return (
    <>
      <PageHeader
        title={isI ? "Receivables & Invoices" : "Payables & Bills"}
        subtitle={`${companyName} · ${isI ? "Money customers owe you" : "Money you owe suppliers"}`}
        actions={<>
          <DateFilter compact />
          <Dropdown align="end"><Dropdown.Toggle variant="light" size="sm"><i className="ti ti-download me-1" />Export</Dropdown.Toggle>
            <Dropdown.Menu>{["xlsx", "pdf", "csv"].map((f) => <Dropdown.Item key={f} href={exportUrl(f)}>{f.toUpperCase()}</Dropdown.Item>)}</Dropdown.Menu></Dropdown>
          {writable && <Button onClick={() => setForm({ open: true })}><i className="ti ti-plus me-1" />New {isI ? "invoice" : "bill"}</Button>}
        </>}
      />
      <Row className="g-4 mb-6">
        <Col xl={3} md={6}><StatCard title={isI ? "Total outstanding" : "Total payable"} tone={1} icon="ti-hourglass" value={inr0(s?.outstanding)} sub="Unpaid + partially paid" loading={!s} /></Col>
        <Col xl={3} md={6}><StatCard title="Overdue" tone={3} icon="ti-alarm" value={inr0(s?.overdue)} sub={`${s?.overdue_n ?? 0} ${isI ? "invoice(s)" : "bill(s)"}`} loading={!s} /></Col>
        <Col xl={3} md={6}><StatCard title={isI ? "Invoiced" : "Billed"} tone={2} icon="ti-file-invoice" value={inr0(s?.billed)} sub="Issued, excl. voided" loading={!s} /></Col>
        <Col xl={3} md={6}><StatCard title={isI ? "Collected" : "Paid"} tone={0} icon="ti-circle-check" value={inr0(s?.paid)} sub="Payments applied" loading={!s} /></Col>
      </Row>
      <SectionCard flush>
        <div className="d-flex flex-wrap gap-2 p-4 border-bottom">
          <Form.Control size="sm" placeholder={`Search ${isI ? "invoice no. or customer" : "bill no. or vendor"}…`} style={{ maxWidth: 280 }} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Form.Select size="sm" style={{ width: 170 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option><option value="paid">Paid</option><option value="partially_paid">Partially paid</option><option value="unpaid">Unpaid</option><option value="overdue">Overdue</option><option value="draft">Draft</option><option value="voided">Voided</option>
          </Form.Select>
        </div>
        <DataTable rows={data?.rows} loading={loading} page={page} pageSize={data?.pageSize} total={data?.total} onPage={setPage} onRow={(r: any) => setDetailId(r.id)} empty={`No ${kind}s match these filters`}
          cols={[
            { key: "no", header: isI ? "Invoice" : "Bill", render: (r: any) => <span className="fw-semibold">{r[isI ? "invoice_no" : "bill_no"].startsWith("DRAFT") ? "Draft" : r[isI ? "invoice_no" : "bill_no"]}</span> },
            ...(company === "all" ? [{ key: "company_name", header: "Company", hideMobile: true } as any] : []),
            { key: "party", header: isI ? "Customer" : "Vendor" },
            { key: "d", header: "Date", hideMobile: true, render: (r: any) => fmtDate(r[isI ? "issue_date" : "bill_date"]) },
            { key: "due", header: "Due", render: (r: any) => <>{fmtDate(r.due_date)}{r.days_overdue > 0 && r.pay_status === "overdue" && <div className="small text-danger">{r.days_overdue}d late</div>}</> },
            { key: "payable", header: isI ? "Amount" : "Payable", align: "end", render: (r: any) => <Money v={r.payable} /> },
            { key: "amount_paid", header: isI ? "Received" : "Paid", align: "end", hideMobile: true, render: (r: any) => <Money v={r.amount_paid} /> },
            { key: "balance", header: "Balance", align: "end", render: (r: any) => <Money v={r.status === "voided" || r.status === "draft" ? 0 : r.balance} bold /> },
            { key: "pay_status", header: "Status", render: (r: any) => <Status value={r.pay_status} /> },
          ]} />
      </SectionCard>

      <DocForm kind={kind} state={form} onClose={() => setForm({ open: false })} onSaved={(id) => { setForm({ open: false }); reload(); if (id) setDetailId(id); }} />
      <DocDetail kind={kind} id={detailId} onClose={() => { setDetailId(null); reload(); }} onEdit={(d: any) => { setDetailId(null); setForm({ open: true, doc: d }); }} />
    </>
  );
}

// ---------- create / edit form with line items ----------
function DocForm({ kind, state, onClose, onSaved }: { kind: "invoice" | "bill"; state: { open: boolean; doc?: any }; onClose: () => void; onSaved: (id?: number) => void }) {
  const isI = kind === "invoice";
  const { meta, company, toast } = useApp();
  const mine = meta!.companies.filter((c) => meta!.user.companyIds.includes(c.id));
  const blankItem = () => ({ description: "", hsn_sac: "", category_id: "", quantity: 1, unit_price: "", discount: 0, gst_rate: 18 });
  const init = () => state.doc
    ? { ...state.doc, items: state.doc.items.map((i: any) => ({ ...i })) }
    : { company_id: company !== "all" ? company : mine.length === 1 ? mine[0].id : "", party_id: "", date: meta!.today, due_date: "", project: "", notes: "", vendor_bill_ref: "", tds_amount: "", items: [blankItem()] };
  const [v, setV] = useState<any>(init()); const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const [lastOpen, setLastOpen] = useState(false);
  if (state.open !== lastOpen) { setLastOpen(state.open); if (state.open) { const n = init(); if (state.doc) { n.party_id = state.doc[isI ? "customer_id" : "vendor_id"]; n.date = state.doc[isI ? "issue_date" : "bill_date"]; } setV(n); setErr(""); } }
  const co = meta!.companies.find((c) => String(c.id) === String(v.company_id));
  const parties = (isI ? meta!.customers : meta!.vendors).filter((p) => String(p.company_id) === String(v.company_id));
  const cats = meta!.categories.filter((c) => c.kind === (isI ? "income" : "expense") && String(c.company_id) === String(v.company_id) && c.active);
  const set = (k: string, val: any) => setV((o: any) => ({ ...o, [k]: val, ...(k === "company_id" ? { party_id: "", items: o.items.map((i: any) => ({ ...i, category_id: "" })) } : {}) }));
  const setItem = (i: number, k: string, val: any) => setV((o: any) => ({ ...o, items: o.items.map((x: any, j: number) => (j === i ? { ...x, [k]: val } : x)) }));
  const calc = v.items.map((i: any) => { const gross = Math.round(Number(i.quantity || 0) * Number(i.unit_price || 0) * 100) / 100; const disc = Number(i.discount || 0); const taxable = gross - disc; const rate = co?.gst_registered ? Number(i.gst_rate || 0) : 0; const tax = Math.round(taxable * rate) / 100; return { gross, disc, taxable, tax, amount: taxable + tax }; });
  const tot = calc.reduce((a: any, c: any) => ({ gross: a.gross + c.gross, disc: a.disc + c.disc, tax: a.tax + c.tax, total: a.total + c.amount }), { gross: 0, disc: 0, tax: 0, total: 0 });
  const party = parties.find((p) => String(p.id) === String(v.party_id));
  const inter = party?.state_code && co?.state_code && party.state_code !== co.state_code;

  const save = async (post: boolean) => {
    setBusy(post ? "post" : "draft"); setErr("");
    try {
      const body: any = { company_id: +v.company_id, [isI ? "customer_id" : "vendor_id"]: +v.party_id, [isI ? "issue_date" : "bill_date"]: v.date, due_date: v.due_date || undefined, project: v.project, notes: v.notes, vendor_bill_ref: v.vendor_bill_ref, tds_amount: Number(v.tds_amount || 0), post,
        items: v.items.map((i: any) => ({ ...i, category_id: +i.category_id, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount || 0), gst_rate: Number(i.gst_rate || 0) })) };
      const row = await api<any>(`${isI ? "/invoices" : "/bills"}${state.doc ? "/" + state.doc.id : ""}`, { method: state.doc ? "PUT" : "POST", body });
      toast(post ? `${isI ? "Invoice" : "Bill"} ${row[isI ? "invoice_no" : "bill_no"]} posted` : "Saved as draft"); onSaved(row.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };

  return (
    <Modal show={state.open} onHide={busy ? undefined : onClose} size="xl" centered backdrop="static" scrollable>
      <Modal.Header closeButton><Modal.Title className="fs-5">{state.doc ? "Edit draft" : `New ${isI ? "invoice" : "purchase bill"}`}</Modal.Title></Modal.Header>
      <Modal.Body>
        <Fields values={v} set={set} fields={[
          { name: "company_id", label: "Company", type: "select", required: true, col: 3, options: mine.map((c) => ({ value: c.id, label: c.name })), disabled: !!state.doc },
          { name: "party_id", label: isI ? "Customer" : "Vendor", type: "select", required: true, col: 3, options: parties.map((p) => ({ value: p.id, label: p.name })) },
          { name: "date", label: isI ? "Invoice date" : "Bill date", type: "date", required: true, col: 2 },
          { name: "due_date", label: "Due date", type: "date", col: 2, hint: party ? `Default: ${party.credit_days} days` : "" },
          ...(isI ? [{ name: "project", label: "Project / ref", col: 2 } as FieldDef] : [{ name: "vendor_bill_ref", label: "Vendor bill no.", col: 2 } as FieldDef]),
        ]} />
        {co && <div className="small text-secondary mt-2">{co.gst_registered ? (inter ? "Inter-state supply → IGST applies" : "Intra-state supply → CGST + SGST applies") : "Company is not GST registered — no tax is charged"} · Number is assigned when {isI ? "issued" : "posted"} ({co.code} sequence)</div>}
        <div className="table-responsive mt-4">
          <table className="table table-sm align-middle">
            <thead><tr><th style={{ minWidth: 200 }}>Description</th>{isI && <th style={{ width: 90 }}>HSN/SAC</th>}<th style={{ minWidth: 150 }}>Category</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 120 }}>Rate</th>{isI && <th style={{ width: 100 }}>Discount</th>}<th style={{ width: 90 }}>GST %</th><th className="text-end" style={{ width: 120 }}>Amount</th><th /></tr></thead>
            <tbody>
              {v.items.map((it: any, i: number) => (
                <tr key={i}>
                  <td><Form.Control size="sm" value={it.description} onChange={(e) => setItem(i, "description", e.target.value)} placeholder="Item / service" /></td>
                  {isI && <td><Form.Control size="sm" value={it.hsn_sac || ""} onChange={(e) => setItem(i, "hsn_sac", e.target.value)} /></td>}
                  <td><Form.Select size="sm" value={it.category_id} onChange={(e) => setItem(i, "category_id", e.target.value)}><option value="">Select…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Form.Select></td>
                  <td><Form.Control size="sm" type="number" min={0} step="0.001" value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} /></td>
                  <td><Form.Control size="sm" type="number" min={0} step="0.01" value={it.unit_price} onChange={(e) => setItem(i, "unit_price", e.target.value)} /></td>
                  {isI && <td><Form.Control size="sm" type="number" min={0} step="0.01" value={it.discount} onChange={(e) => setItem(i, "discount", e.target.value)} /></td>}
                  <td><Form.Select size="sm" value={it.gst_rate} disabled={!co?.gst_registered} onChange={(e) => setItem(i, "gst_rate", e.target.value)}>{GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</Form.Select></td>
                  <td className="text-end fw-semibold">{inr(calc[i].amount)}</td>
                  <td><button className="btn btn-sm text-danger" disabled={v.items.length === 1} onClick={() => setV((o: any) => ({ ...o, items: o.items.filter((_: any, j: number) => j !== i) }))} aria-label="Remove line"><i className="ti ti-trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button variant="outline-primary" size="sm" onClick={() => setV((o: any) => ({ ...o, items: [...o.items, blankItem()] }))}><i className="ti ti-plus me-1" />Add line</Button>
        </div>
        <Row className="mt-4 g-4">
          <Col md={7}>
            <Fields values={v} set={set} fields={[
              { name: "notes", label: "Notes", type: "textarea", col: 12 },
              ...(!isI ? [{ name: "tds_amount", label: "TDS to deduct from vendor", type: "money", col: 6, hint: "Reduces the amount you pay; posted to TDS payable" } as FieldDef] : []),
            ]} />
          </Col>
          <Col md={5}>
            <div className="border rounded-3 p-4">
              <div className="d-flex justify-content-between"><span className="text-secondary">Subtotal</span><span>{inr(tot.gross)}</span></div>
              {isI && <div className="d-flex justify-content-between"><span className="text-secondary">Discount</span><span>− {inr(tot.disc)}</span></div>}
              <div className="d-flex justify-content-between"><span className="text-secondary">GST</span><span>{inr(tot.tax)}</span></div>
              <hr className="my-2" />
              <div className="d-flex justify-content-between fs-5 fw-bold"><span>Total</span><span>{inr(tot.total)}</span></div>
              {!isI && Number(v.tds_amount) > 0 && <div className="d-flex justify-content-between small text-secondary"><span>Net payable after TDS</span><span>{inr(tot.total - Number(v.tds_amount))}</span></div>}
              <div className="small text-secondary mt-2">Preview only — the server recomputes and validates every amount.</div>
            </div>
          </Col>
        </Row>
        {err && <div className="alert alert-danger py-2 mt-4 mb-0 small"><i className="ti ti-alert-circle me-1" />{err}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="light" onClick={onClose} disabled={!!busy}>Cancel</Button>
        <Button variant="outline-primary" onClick={() => save(false)} disabled={!!busy}>{busy === "draft" && <Spinner size="sm" className="me-2" />}Save draft</Button>
        <Button onClick={() => save(true)} disabled={!!busy}>{busy === "post" && <Spinner size="sm" className="me-2" />}{isI ? "Issue invoice" : "Post bill"}</Button>
      </Modal.Footer>
    </Modal>
  );
}

// ---------- detail with payments ----------
function DocDetail({ kind, id, onClose, onEdit }: { kind: "invoice" | "bill"; id: number | null; onClose: () => void; onEdit: (d: any) => void }) {
  const isI = kind === "invoice";
  const { meta, can, toast } = useApp();
  const base = isI ? "/invoices" : "/bills";
  const { data: d, loading, reload } = useQuery<any>(id ? `${base}/${id}` : null, {}, { scoped: false, range: false });
  const [paying, setPaying] = useState(false); const [pay, setPay] = useState<any>({}); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [voidDoc, setVoidDoc] = useState(false); const [voidPay, setVoidPay] = useState<any>(null);
  const writable = can("invoice.write"), canPay = can("txn.write");
  const banks = meta!.banks.filter((b) => d && b.company_id === d.company_id && b.active);
  const payable = d ? (isI ? d.total : d.total - d.tds_amount) : 0; const balance = d ? payable - d.amount_paid : 0;
  const no = d?.[isI ? "invoice_no" : "bill_no"];
  const act = async (path: string, msg: string, body: any = {}) => { try { await api(path, { body }); toast(msg); reload(); } catch (e: any) { toast(e.message, "danger"); } };
  const record = async () => {
    setBusy(true); setErr("");
    try { await api(`${base}/${id}/payments`, { body: { bank_account_id: +pay.bank_account_id, amount: Number(pay.amount), pay_date: pay.pay_date, method: pay.method, reference: pay.reference } }); toast(`${isI ? "Receipt" : "Payment"} recorded`); setPaying(false); reload(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const share = (how: string) => {
    const url = `${location.origin}/api/invoices/${id}/pdf`; const txt = `Invoice ${no} from ${meta!.companies.find((c) => c.id === d.company_id)?.name}: ${inr(d.total)} due ${fmtDate(d.due_date)}`;
    if (how === "copy") { navigator.clipboard.writeText(url).then(() => toast("PDF link copied (requires sign-in to open)")); }
    else if (how === "mail") location.href = `mailto:${d.party?.email || ""}?subject=${encodeURIComponent("Invoice " + no)}&body=${encodeURIComponent(txt + "\n\nPlease find the invoice attached. " + url)}`;
    else window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, "_blank");
  };
  return (
    <>
      <Modal show={!!id} onHide={onClose} size="xl" centered scrollable>
        {loading || !d ? <Modal.Body><Loading /></Modal.Body> : (
          <>
            <Modal.Header closeButton>
              <Modal.Title className="fs-5">{no.startsWith("DRAFT") ? "Draft" : no} <Status value={d.pay_status} /></Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Row className="g-3 mb-4">
                <Col md={3}><div className="text-secondary small">{isI ? "Customer" : "Vendor"}</div><div className="fw-semibold">{d.party?.name}</div><div className="small text-secondary">{d.party?.gstin || ""}</div></Col>
                <Col md={2}><div className="text-secondary small">{isI ? "Issued" : "Bill date"}</div><div className="fw-semibold">{fmtDate(d[isI ? "issue_date" : "bill_date"])}</div></Col>
                <Col md={2}><div className="text-secondary small">Due</div><div className="fw-semibold">{fmtDate(d.due_date)}</div></Col>
                <Col md={2}><div className="text-secondary small">Tax</div><div className="fw-semibold">{d.tax_type === "IGST" ? "IGST" : d.tax_type === "NONE" ? "None" : "CGST + SGST"}</div></Col>
                <Col md={3} className="text-md-end"><div className="text-secondary small">Balance</div><div className="fs-4 fw-bold">{inr(d.status === "voided" ? 0 : balance)}</div></Col>
              </Row>
              <div className="table-responsive"><table className="table table-sm"><thead><tr><th>Description</th><th>Category</th><th className="text-end">Qty</th><th className="text-end">Rate</th>{isI && <th className="text-end">Disc.</th>}<th className="text-end">GST%</th><th className="text-end">Amount</th></tr></thead>
                <tbody>{d.items.map((i: any) => <tr key={i.id}><td>{i.description}</td><td>{i.category}</td><td className="text-end">{+i.quantity}</td><td className="text-end">{inr(i.unit_price)}</td>{isI && <td className="text-end">{inr(i.discount)}</td>}<td className="text-end">{+i.gst_rate}%</td><td className="text-end">{inr(i.amount)}</td></tr>)}</tbody></table></div>
              <div className="ms-auto small" style={{ maxWidth: 300 }}>
                {[["Subtotal", d.subtotal], ...(isI ? [["Discount", -d.discount_total]] : []), ["CGST", d.cgst], ["SGST", d.sgst], ["IGST", d.igst], ...(!isI && d.tds_amount > 0 ? [["TDS withheld", -d.tds_amount]] : [])].filter(([, a]) => Number(a) !== 0).map(([k, a]) => <div key={k as string} className="d-flex justify-content-between"><span className="text-secondary">{k}</span><span>{inr(a as number)}</span></div>)}
                <div className="d-flex justify-content-between fw-bold fs-6 border-top mt-1 pt-1"><span>{isI ? "Total" : "Payable"}</span><span>{inr(payable)}</span></div>
                <div className="d-flex justify-content-between"><span className="text-secondary">{isI ? "Received" : "Paid"}</span><span>{inr(d.amount_paid)}</span></div>
              </div>
              <h3 className="fs-6 mt-5">Payment history</h3>
              {d.payments.length === 0 ? <div className="text-secondary small">No payments yet.</div> : (
                <table className="table table-sm"><thead><tr><th>Date</th><th>Account</th><th>Method / ref</th><th className="text-end">Amount</th><th>Status</th><th /></tr></thead>
                  <tbody>{d.payments.map((p: any) => <tr key={p.id}><td>{fmtDate(p.pay_date)}</td><td>{p.bank_name}</td><td>{[p.method, p.reference].filter(Boolean).join(" · ")}</td><td className="text-end">{inr(p.amount)}</td><td><Status value={p.status === "posted" ? "posted" : "voided"} /></td>
                    <td className="text-end">{p.status === "posted" && canPay && <Button size="sm" variant="link" className="text-danger p-0" onClick={() => setVoidPay(p)}>Void</Button>}</td></tr>)}</tbody></table>
              )}
              {d.void_reason && <div className="alert alert-secondary py-2 small">Voided: {d.void_reason}</div>}
            </Modal.Body>
            <Modal.Footer className="flex-wrap">
              {isI && d.status !== "draft" && <><Button variant="light" href={`/api/invoices/${id}/pdf`} target="_blank"><i className="ti ti-printer me-1" />Print / view PDF</Button>
                <Button variant="light" href={`/api/invoices/${id}/pdf?download=1`}><i className="ti ti-file-download me-1" />Download</Button>
                <Dropdown><Dropdown.Toggle variant="light"><i className="ti ti-share me-1" />Share</Dropdown.Toggle><Dropdown.Menu><Dropdown.Item onClick={() => share("mail")}>Email</Dropdown.Item><Dropdown.Item onClick={() => share("wa")}>WhatsApp message</Dropdown.Item><Dropdown.Item onClick={() => share("copy")}>Copy PDF link</Dropdown.Item></Dropdown.Menu></Dropdown></>}
              {d.status === "draft" && writable && <><Button variant="light" onClick={() => onEdit(d)}><i className="ti ti-edit me-1" />Edit</Button><Button variant="success" onClick={() => act(`${base}/${id}/${isI ? "issue" : "post"}`, isI ? "Invoice issued" : "Bill posted")}>{isI ? "Issue invoice" : "Post bill"}</Button><Button variant="outline-danger" onClick={async () => { try { await api(`${base}/${id}`, { method: "DELETE" }); toast("Draft deleted"); onClose(); } catch (e: any) { toast(e.message, "danger"); } }}>Delete draft</Button></>}
              {d.status === "posted" && canPay && balance > 0 && <Button onClick={() => { setPay({ bank_account_id: banks[0]?.id || "", amount: balance, pay_date: meta!.today, method: "Bank transfer", reference: "" }); setErr(""); setPaying(true); }}><i className="ti ti-cash me-1" />{isI ? "Record receipt" : "Record payment"}</Button>}
              {d.status === "posted" && writable && <Button variant="outline-danger" onClick={() => setVoidDoc(true)}><i className="ti ti-ban me-1" />Void</Button>}
              <Button variant="light" onClick={onClose}>Close</Button>
            </Modal.Footer>
          </>
        )}
      </Modal>

      <Modal show={paying} onHide={() => setPaying(false)} centered backdrop="static">
        <Modal.Header closeButton><Modal.Title className="fs-5">{isI ? "Record receipt" : "Record payment"} · {no}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Fields values={pay} set={(k, val) => setPay((o: any) => ({ ...o, [k]: val }))} fields={[
            { name: "amount", label: `Amount (balance ${inr(balance)})`, type: "money", required: true, col: 6, hint: "Partial payments are allowed" },
            { name: "pay_date", label: "Date", type: "date", required: true, col: 6 },
            { name: "bank_account_id", label: isI ? "Received into" : "Paid from", type: "select", required: true, col: 12, options: banks.map((b) => ({ value: b.id, label: `${b.name} (${inr(b.balance)})` })) },
            { name: "method", label: "Method", type: "select", options: METHODS, col: 6 }, { name: "reference", label: "Reference / UTR", col: 6 },
          ]} />
          {err && <div className="alert alert-danger py-2 mt-3 mb-0 small">{err}</div>}
        </Modal.Body>
        <Modal.Footer><Button variant="light" onClick={() => setPaying(false)}>Cancel</Button><Button onClick={record} disabled={busy}>{busy && <Spinner size="sm" className="me-2" />}Save</Button></Modal.Footer>
      </Modal>
      <ReasonModal show={voidDoc} title={`Void ${no}`} message="The accounting entry is reversed and the document is kept as voided. Payments must be voided first." confirmLabel={`Void ${kind}`} onConfirm={async (reason) => { await api(`${base}/${id}/void`, { body: { reason } }); toast("Voided"); setVoidDoc(false); reload(); }} onClose={() => setVoidDoc(false)} />
      <ReasonModal show={!!voidPay} title="Void payment" message={voidPay && `${inr(voidPay.amount)} on ${fmtDate(voidPay.pay_date)} will be reversed.`} confirmLabel="Void payment" onConfirm={async (reason) => { await api(`/payments/${voidPay.id}/void`, { body: { reason } }); toast("Payment voided"); setVoidPay(null); reload(); }} onClose={() => setVoidPay(null)} />
    </>
  );
}
void fmtTs; void addDays;
