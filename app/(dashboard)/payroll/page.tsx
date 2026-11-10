"use client";
import { useState } from "react";
import { Button, Col, Form, Modal, Row, Tab, Tabs } from "react-bootstrap";
import { useApp, useQuery } from "components/erp/AppProvider";
import { DataTable, FieldDef, FormModal, Loading, Money, PageHeader, SectionCard, StatCard, Status } from "components/erp/ui";
import { api, fmtDate, inr, inr0 } from "lib/client";

export default function Payroll() {
  const { meta, can, toast, companyName, company } = useApp();
  const write = can("payroll.write"); const mine = meta!.companies.filter((c) => meta!.user.companyIds.includes(c.id));
  const { data: runs, reload } = useQuery<any[]>("/payroll", {}, { scoped: true, range: false });
  const { data: emps, reload: reloadEmps } = useQuery<any>("/employees", { pageSize: 100 }, { scoped: true, range: false });
  const { data: advs, reload: reloadAdv } = useQuery<any[]>("/advances", {}, { scoped: true, range: false });
  const [newRun, setNewRun] = useState(false); const [open, setOpen] = useState<number | null>(null);
  const [empForm, setEmpForm] = useState<{ show: boolean; edit?: any }>({ show: false }); const [advForm, setAdvForm] = useState(false);
  const cur = new Date().toISOString().slice(0, 7);
  const empFields: FieldDef[] = [
    { name: "company_id", label: "Company", type: "select", required: true, options: mine.map((c) => ({ value: c.id, label: c.name })), disabled: () => !!empForm.edit },
    { name: "emp_code", label: "Employee code", required: true, disabled: () => !!empForm.edit }, { name: "name", label: "Name", required: true }, { name: "designation", label: "Designation" },
    { name: "department", label: "Department" }, { name: "join_date", label: "Joining date", type: "date" }, { name: "email", label: "Email", type: "email" }, { name: "pan", label: "PAN" },
    { name: "basic", label: "Basic salary / month", type: "money", required: true, col: 4 }, { name: "allowances", label: "Allowances", type: "money", col: 4 }, { name: "deductions", label: "Standard deductions", type: "money", col: 4, hint: "PF / PT / TDS withheld from salary" },
  ];
  const totalPay = (runs || []).filter((r) => r.month === cur).reduce((s, r) => s + r.total_net, 0);
  return (
    <>
      <PageHeader title="Payroll" subtitle={`${companyName} · Restricted to authorised users · every action is audited`}
        actions={<>{write && <Button variant="light" onClick={() => setAdvForm(true)}><i className="ti ti-cash-banknote me-1" />Salary advance</Button>}{write && <Button onClick={() => setNewRun(true)}><i className="ti ti-plus me-1" />New payroll run</Button>}</>} />
      <Row className="g-4 mb-6">
        <Col md={4}><StatCard title="Active employees" tone={1} icon="ti-users" value={String(emps?.rows?.filter((e: any) => e.active).length ?? "…")} loading={!emps} /></Col>
        <Col md={4}><StatCard title={`Net payroll ${cur}`} tone={0} icon="ti-coins" value={inr0(totalPay)} sub="Salary payable this month" loading={!runs} /></Col>
        <Col md={4}><StatCard title="Outstanding advances" tone={2} icon="ti-cash-banknote" value={inr0((advs || []).reduce((s, a) => s + a.amount, 0))} sub="Total advances given" loading={!advs} /></Col>
      </Row>
      <Tabs defaultActiveKey="runs" className="mb-4" mountOnEnter>
        <Tab eventKey="runs" title="Monthly payroll">
          <SectionCard flush><DataTable rows={runs} empty="No payroll runs yet" onRow={(r: any) => setOpen(r.id)} cols={[
            { key: "month", header: "Month", render: (r: any) => <span className="fw-semibold">{r.month}</span> }, { key: "company_name", header: "Company", hideMobile: true }, { key: "employees", header: "Staff", align: "end" },
            { key: "g", header: "Gross", align: "end", render: (r: any) => <Money v={r.total_gross} /> }, { key: "d", header: "Deductions", align: "end", hideMobile: true, render: (r: any) => <Money v={r.total_deductions} /> }, { key: "n", header: "Net payable", align: "end", render: (r: any) => <Money v={r.total_net} bold /> },
            { key: "s", header: "Status", render: (r: any) => <Status value={r.status === "paid" ? "paid" : r.status} label={r.status === "posted" ? "Posted · unpaid" : undefined} /> }]} /></SectionCard>
        </Tab>
        <Tab eventKey="emps" title="Employees">
          <div className="d-flex justify-content-end mb-3">{write && <Button size="sm" onClick={() => setEmpForm({ show: true })}><i className="ti ti-plus me-1" />Add employee</Button>}</div>
          <SectionCard flush><DataTable rows={emps?.rows?.filter((e: any) => e.active)} cols={[
            { key: "emp_code", header: "Code" }, { key: "name", header: "Name", render: (r: any) => <span className="fw-semibold">{r.name}</span> }, { key: "designation", header: "Designation", hideMobile: true }, { key: "company_name", header: "Company", hideMobile: true },
            { key: "basic", header: "Basic", align: "end", render: (r: any) => <Money v={r.basic} /> }, { key: "allowances", header: "Allowances", align: "end", hideMobile: true, render: (r: any) => <Money v={r.allowances} /> }, { key: "deductions", header: "Deductions", align: "end", hideMobile: true, render: (r: any) => <Money v={r.deductions} /> },
            { key: "a", header: "", align: "end", render: (r: any) => write && <Button size="sm" variant="light" onClick={() => setEmpForm({ show: true, edit: r })}><i className="ti ti-edit" /></Button> }]} /></SectionCard>
        </Tab>
        <Tab eventKey="adv" title="Advances">
          <SectionCard flush><DataTable rows={advs} empty="No advances recorded" cols={[{ key: "advance_date", header: "Date", render: (r: any) => fmtDate(r.advance_date) }, { key: "employee", header: "Employee" }, { key: "company_name", header: "Company", hideMobile: true }, { key: "bank", header: "Paid from", hideMobile: true }, { key: "amount", header: "Amount", align: "end", render: (r: any) => <Money v={r.amount} bold /> }, { key: "notes", header: "Notes", hideMobile: true }]} /></SectionCard>
        </Tab>
      </Tabs>

      <FormModal show={newRun} title="New payroll run" onClose={() => setNewRun(false)} size="sm" initial={{ company_id: company !== "all" ? company : mine.length === 1 ? mine[0].id : "", month: cur }}
        fields={[{ name: "company_id", label: "Company", type: "select", required: true, col: 12, options: mine.map((c) => ({ value: c.id, label: c.name })) }, { name: "month", label: "Month", type: "month" as any, required: true, col: 12 }]}
        onSubmit={async (v) => { const p = await api<any>("/payroll", { body: { company_id: +v.company_id, month: v.month } }); toast("Draft payroll created from employee master"); setNewRun(false); reload(); setOpen(p.id); }} />
      <FormModal show={empForm.show} title={empForm.edit ? `Edit ${empForm.edit.name}` : "Add employee"} fields={empFields} onClose={() => setEmpForm({ show: false })}
        initial={empForm.edit || { company_id: company !== "all" ? company : mine.length === 1 ? mine[0].id : "", basic: "", allowances: 0, deductions: 0 }}
        onSubmit={async (v) => { const body = { ...v, company_id: +v.company_id, basic: Number(v.basic), allowances: Number(v.allowances || 0), deductions: Number(v.deductions || 0) }; empForm.edit ? await api(`/employees/${empForm.edit.id}`, { method: "PUT", body }) : await api("/employees", { body }); toast("Saved"); setEmpForm({ show: false }); reloadEmps(); }} />
      <FormModal show={advForm} title="Salary advance" onClose={() => setAdvForm(false)} initial={{ company_id: company !== "all" ? company : mine.length === 1 ? mine[0].id : "", advance_date: meta!.today }}
        fields={[{ name: "company_id", label: "Company", type: "select", required: true, options: mine.map((c) => ({ value: c.id, label: c.name })) }, { name: "employee_id", label: "Employee", type: "select", required: true, options: (v) => meta!.employees.filter((e) => String(e.company_id) === String(v.company_id)).map((e) => ({ value: e.id, label: `${e.name} (${e.emp_code})` })) },
          { name: "amount", label: "Amount", type: "money", required: true }, { name: "advance_date", label: "Date", type: "date", required: true }, { name: "bank_account_id", label: "Paid from", type: "select", required: true, options: (v) => meta!.banks.filter((b) => String(b.company_id) === String(v.company_id) && b.active).map((b) => ({ value: b.id, label: b.name })) }, { name: "notes", label: "Notes", type: "textarea", col: 12 }]}
        transform={(o, k, val) => (k === "company_id" ? { ...o, company_id: val, employee_id: "", bank_account_id: "" } : { ...o, [k]: val })}
        onSubmit={async (v) => { await api("/advances", { body: { ...v, company_id: +v.company_id, employee_id: +v.employee_id, bank_account_id: +v.bank_account_id, amount: Number(v.amount) } }); toast("Advance recorded (asset: employee advances)"); setAdvForm(false); reloadAdv(); }} />
      <RunDetail id={open} onClose={() => { setOpen(null); reload(); }} />
    </>
  );
}

function RunDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { meta, can, toast } = useApp();
  const { data: p, reload, loading } = useQuery<any>(id ? `/payroll/${id}` : null, {}, { scoped: false, range: false });
  const [pay, setPay] = useState(false); const [f, setF] = useState<any>({}); const [err, setErr] = useState(""); const [edits, setEdits] = useState<Record<number, any>>({});
  const write = can("payroll.write");
  const banks = meta!.banks.filter((b) => p && b.company_id === p.company_id && b.active);
  const act = async (path: string, msg: string, body: any = {}) => { try { await api(path, { body }); toast(msg); reload(); } catch (e: any) { toast(e.message, "danger"); } };
  const saveItem = async (it: any) => { try { await api(`/payroll/items/${it.id}`, { method: "PUT", body: edits[it.id] }); setEdits(({ [it.id]: _, ...r }) => r); toast("Updated"); reload(); } catch (e: any) { toast(e.message, "danger"); } };
  return (
    <Modal show={!!id} onHide={onClose} size="xl" centered scrollable>
      {loading || !p ? <Modal.Body><Loading /></Modal.Body> : (
        <>
          <Modal.Header closeButton><Modal.Title className="fs-5">{p.company_name} · payroll {p.month} <Status value={p.status === "paid" ? "paid" : p.status} /></Modal.Title></Modal.Header>
          <Modal.Body className="p-0">
            <div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Employee</th><th className="text-end">Basic</th><th className="text-end">Allowances</th><th className="text-end">Deductions</th><th className="text-end">Advance rec.</th><th className="text-end">Net</th><th className="text-end">Paid</th><th /></tr></thead>
              <tbody>{p.items.map((it: any) => {
                const ed = edits[it.id]; const draft = p.status === "draft" && write;
                const cell = (k: string) => draft ? <Form.Control size="sm" type="number" step="0.01" className="text-end" style={{ width: 110, marginLeft: "auto" }} value={ed?.[k] ?? it[k]} onChange={(e) => setEdits({ ...edits, [it.id]: { ...(edits[it.id] || {}), [k]: e.target.value } })} /> : inr(it[k]);
                return <tr key={it.id}><td><div className="fw-semibold">{it.name}</div><div className="small text-secondary">{it.emp_code} · {it.designation}</div></td><td className="text-end">{cell("basic")}</td><td className="text-end">{cell("allowances")}</td><td className="text-end">{cell("deductions")}</td><td className="text-end">{cell("advance_recovery")}</td><td className="text-end fw-semibold">{inr(it.net)}</td><td className="text-end">{inr(it.paid_amount)}</td>
                  <td className="text-end text-nowrap">{ed && <Button size="sm" onClick={() => saveItem(it)}>Save</Button>} {p.status !== "draft" && <Button size="sm" variant="light" href={`/api/payroll/items/${it.id}/payslip`} target="_blank"><i className="ti ti-file-type-pdf me-1" />Payslip</Button>}</td></tr>;
              })}</tbody>
              <tfoot><tr className="fw-bold"><td>Total</td><td /><td /><td className="text-end">{inr(p.total_deductions)}</td><td /><td className="text-end">{inr(p.total_net)}</td><td /><td /></tr></tfoot></table></div>
            <div className="p-3 small text-secondary">Gross {inr(p.total_gross)} is posted to Salaries &amp; Wages; deductions to TDS &amp; statutory payable; net to Salary payable until paid.</div>
          </Modal.Body>
          <Modal.Footer>
            {p.status === "draft" && write && <Button variant="success" onClick={() => act(`/payroll/${id}/post`, "Payroll posted to the ledger")}>Post payroll</Button>}
            {["posted", "paid"].includes(p.status) && write && p.status !== "paid" && <Button onClick={() => { setF({ bank_account_id: banks[0]?.id || "", pay_date: meta!.today }); setErr(""); setPay(true); }}><i className="ti ti-cash me-1" />Pay salaries</Button>}
            <Button variant="light" onClick={onClose}>Close</Button>
          </Modal.Footer>
          <Modal show={pay} onHide={() => setPay(false)} centered>
            <Modal.Header closeButton><Modal.Title className="fs-5">Pay salaries · {inr(p.total_net - p.items.reduce((s: number, i: any) => s + i.paid_amount, 0))}</Modal.Title></Modal.Header>
            <Modal.Body><Row className="g-3"><Col md={7}><Form.Label className="small fw-semibold">Paid from</Form.Label><Form.Select value={f.bank_account_id} onChange={(e) => setF({ ...f, bank_account_id: e.target.value })}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name} ({inr(b.balance)})</option>)}</Form.Select></Col><Col md={5}><Form.Label className="small fw-semibold">Date</Form.Label><Form.Control type="date" value={f.pay_date} onChange={(e) => setF({ ...f, pay_date: e.target.value })} /></Col></Row>{err && <div className="alert alert-danger py-2 mt-3 mb-0 small">{err}</div>}</Modal.Body>
            <Modal.Footer><Button variant="light" onClick={() => setPay(false)}>Cancel</Button><Button onClick={async () => { try { await api(`/payroll/${id}/pay`, { body: { bank_account_id: +f.bank_account_id, pay_date: f.pay_date } }); toast("Salaries paid"); setPay(false); reload(); } catch (e: any) { setErr(e.message); } }}>Confirm payment</Button></Modal.Footer>
          </Modal>
        </>
      )}
    </Modal>
  );
}
