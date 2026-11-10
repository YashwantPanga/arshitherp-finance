"use client";
import { useState } from "react";
import { Badge, Button, Col, Form, Modal, Row, Spinner } from "react-bootstrap";
import { useApp, useQuery } from "components/erp/AppProvider";
import { DataTable, FormModal, Loading, Money, PageHeader, ReasonModal, SectionCard, StatCard, Status } from "components/erp/ui";
import { api, fmtDate, inr, inr0 } from "lib/client";

const TYPE_ICON: Record<string, string> = { cash: "ti-cash", bank: "ti-building-bank", upi: "ti-device-mobile", wallet: "ti-wallet" };
const MOVES = [
  { value: "transfer", label: "Transfer between accounts (internal)" }, { value: "capital", label: "Owner capital introduced" }, { value: "drawing", label: "Owner drawings" },
  { value: "loan_in", label: "Loan received" }, { value: "loan_repay", label: "Loan repayment (principal)" },
];

export default function Banking() {
  const { meta, company, can, toast, companyName, reload: reloadMeta } = useApp();
  const { data: accounts, loading, reload } = useQuery<any[]>("/bank-accounts", {}, { scoped: true, range: false });
  const { data: moves, reload: reloadMoves } = useQuery<any>("/transactions", { kind: "transfer,capital,drawing,loan_in,loan_repay", pageSize: 15 }, { scoped: true, range: false });
  const [modal, setModal] = useState<"" | "account" | "move" | "opening">(""); const [target, setTarget] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null); const [rec, setRec] = useState<any>(null);
  const write = can("bank.write"), recon = can("reconcile");
  const mine = meta!.companies.filter((c) => meta!.user.companyIds.includes(c.id));
  const total = (t: string[]) => (accounts || []).filter((a) => t.includes(a.account_type)).reduce((s, a) => s + a.balance, 0);
  const refresh = () => { reload(); reloadMoves(); reloadMeta(); };

  return (
    <>
      <PageHeader title="Cash & Bank" subtitle={`${companyName} · every balance is the sum of posted ledger movements`}
        actions={<>{write && <Button variant="light" onClick={() => setModal("move")}><i className="ti ti-arrows-exchange me-1" />Transfer / capital / loan</Button>}{write && <Button onClick={() => setModal("account")}><i className="ti ti-plus me-1" />Add account</Button>}</>} />
      <Row className="g-4 mb-6">
        <Col xl={4} md={6}><StatCard title="Cash in hand" tone={2} icon="ti-cash" value={inr0(total(["cash"]))} sub="Physical cash accounts" loading={!accounts} /></Col>
        <Col xl={4} md={6}><StatCard title="Bank, UPI & wallets" tone={1} icon="ti-building-bank" value={inr0(total(["bank", "upi", "wallet"]))} sub={`${accounts?.filter((a) => a.account_type !== "cash").length ?? 0} accounts`} loading={!accounts} /></Col>
        <Col xl={4} md={12}><StatCard title="Total liquidity" tone={0} icon="ti-coins" value={inr0(total(["cash", "bank", "upi", "wallet"]))} sub="Transfers between accounts never change this" loading={!accounts} /></Col>
      </Row>

      <Row className="g-4 mb-6">
        {loading && !accounts && <Loading />}
        {accounts?.map((a) => (
          <Col xl={4} md={6} key={a.id}>
            <div className="card h-100"><div className="card-body">
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div className="d-flex gap-3 align-items-center">
                  <span className="icon-shape icon-md rounded-3 bg-primary-subtle text-primary-emphasis d-inline-flex align-items-center justify-content-center" style={{ width: 42, height: 42 }}><i className={`ti ${TYPE_ICON[a.account_type]} fs-4`} /></span>
                  <div><div className="fw-semibold">{a.name}</div><div className="text-secondary small">{a.bank_name || "—"} {a.account_ref && `· ${a.account_ref}`}</div></div>
                </div>
                <Badge bg="secondary-subtle" text="secondary-emphasis">{a.account_type}</Badge>
              </div>
              <div className="fs-3 fw-bold mb-1" style={{ fontVariantNumeric: "tabular-nums" }}>{inr(a.balance)}</div>
              <div className="text-secondary small mb-3">{company === "all" && <>{a.company_name} · </>}Opening {inr(a.opening_balance)} · {a.last_reconciled ? `reconciled ${fmtDate(a.last_reconciled)}` : "never reconciled"}</div>
              <div className="d-flex flex-wrap gap-2">
                <Button size="sm" variant="light" onClick={async () => setLedger(await api(`/bank-accounts/${a.id}/ledger`))}><i className="ti ti-list-details me-1" />History</Button>
                {recon && <Button size="sm" variant="light" onClick={async () => setRec({ ...(await api(`/bank-accounts/${a.id}/reconcile`)), statement_date: meta!.today, statement_balance: "", picked: new Set<number>() })}><i className="ti ti-checks me-1" />Reconcile</Button>}
                {write && <Button size="sm" variant="light" onClick={() => { setTarget(a); setModal("opening"); }}><i className="ti ti-adjustments me-1" />Opening balance</Button>}
              </div>
            </div></div>
          </Col>
        ))}
      </Row>

      <SectionCard title="Recent transfers & capital movements" flush>
        <DataTable rows={moves?.rows} cols={[
          { key: "d", header: "Date", render: (r: any) => fmtDate(r.txn_date) }, { key: "txn_no", header: "Reference", hideMobile: true },
          { key: "kind", header: "Type", render: (r: any) => MOVES.find((m) => m.value === r.kind)?.label.split(" (")[0] || r.kind },
          { key: "flow", header: "Account(s)", render: (r: any) => (r.kind === "transfer" ? `${r.bank_name} → ${r.to_bank_name}` : r.bank_name) },
          { key: "amount", header: "Amount", align: "end", render: (r: any) => <Money v={r.amount} bold /> },
          { key: "status", header: "Status", render: (r: any) => <Status value={r.status} /> },
        ]} empty="No transfers yet" />
      </SectionCard>

      <AccountForm show={modal === "account"} onClose={() => setModal("")} onDone={() => { setModal(""); refresh(); }} />
      <MoveForm show={modal === "move"} onClose={() => setModal("")} onDone={() => { setModal(""); refresh(); }} />
      <FormModal show={modal === "opening"} title={`Adjust opening balance · ${target?.name}`} size="lg" initial={{ opening_balance: target?.opening_balance, reason: "" }}
        fields={[{ name: "opening_balance", label: "New opening balance", type: "money", required: true, col: 6, hint: `Current ${inr(target?.opening_balance)}` }, { name: "reason", label: "Reason (audit trail)", type: "textarea", required: true, col: 12 }]}
        onSubmit={async (v) => { await api(`/bank-accounts/${target.id}/opening`, { body: { opening_balance: Number(v.opening_balance), reason: v.reason } }); toast("Adjusting entry posted and logged"); setModal(""); refresh(); }} onClose={() => setModal("")}>
        {() => <div className="alert alert-info py-2 mt-3 mb-0 small">History is never rewritten: the difference is posted as an adjusting entry against Opening Balance Equity and recorded in the audit log.</div>}
      </FormModal>

      <Modal show={!!ledger} onHide={() => setLedger(null)} size="xl" centered scrollable>
        <Modal.Header closeButton><Modal.Title className="fs-5">Transaction history · {ledger?.account.name}</Modal.Title></Modal.Header>
        <Modal.Body className="p-0">
          <DataTable dense rows={ledger?.rows} cols={[
            { key: "d", header: "Date", render: (r: any) => fmtDate(r.entry_date) }, { key: "entry_no", header: "Entry", hideMobile: true }, { key: "memo", header: "Narration" },
            { key: "debit", header: "In", align: "end", render: (r: any) => (r.debit ? <Money v={r.debit} /> : "") }, { key: "credit", header: "Out", align: "end", render: (r: any) => (r.credit ? <Money v={-r.credit} /> : "") },
            { key: "balance", header: "Balance", align: "end", render: (r: any) => <Money v={r.balance} bold /> }, { key: "rc", header: "", render: (r: any) => (r.reconciled ? <i className="ti ti-circle-check text-success" title="Reconciled" /> : "") },
          ]} />
          <div className="text-secondary small p-3">Showing the latest 300 lines.</div>
        </Modal.Body>
      </Modal>
      <Reconcile state={rec} setState={setRec} onDone={() => { setRec(null); refresh(); }} />
    </>
  );
}

function AccountForm({ show, onClose, onDone }: { show: boolean; onClose: () => void; onDone: () => void }) {
  const { meta, company, toast } = useApp(); const mine = meta!.companies.filter((c) => meta!.user.companyIds.includes(c.id));
  return (
    <FormModal show={show} title="Add bank / cash account" onClose={onClose}
      initial={{ company_id: company !== "all" ? company : mine.length === 1 ? mine[0].id : "", account_type: "bank", opening_date: meta!.today, opening_balance: 0 }}
      fields={[
        { name: "company_id", label: "Company", type: "select", required: true, options: mine.map((c) => ({ value: c.id, label: c.name })) },
        { name: "name", label: "Account name", required: true, placeholder: "Primary Current Account" },
        { name: "account_type", label: "Type", type: "select", required: true, options: [{ value: "bank", label: "Bank account" }, { value: "cash", label: "Cash in hand" }, { value: "upi", label: "UPI / gateway settlement" }, { value: "wallet", label: "Wallet" }] },
        { name: "bank_name", label: "Bank name" },
        { name: "account_ref", label: "Account number", hint: "Only the last 4 digits are stored", show: (v) => v.account_type !== "cash" },
        { name: "opening_balance", label: "Opening balance", type: "money" }, { name: "opening_date", label: "Opening date", type: "date" },
      ]}
      onSubmit={async (v) => { await api("/bank-accounts", { body: { ...v, company_id: +v.company_id, opening_balance: Number(v.opening_balance || 0) } }); toast("Account created"); onDone(); }} />
  );
}

function MoveForm({ show, onClose, onDone }: { show: boolean; onClose: () => void; onDone: () => void }) {
  const { meta, company, toast } = useApp(); const mine = meta!.companies.filter((c) => meta!.user.companyIds.includes(c.id));
  const banks = (v: any) => meta!.banks.filter((b) => String(b.company_id) === String(v.company_id) && b.active).map((b) => ({ value: b.id, label: `${b.name} (${inr(b.balance)})` }));
  return (
    <FormModal show={show} title="Transfer, capital or loan movement" onClose={onClose}
      initial={{ company_id: company !== "all" ? company : mine.length === 1 ? mine[0].id : "", kind: "transfer", txn_date: meta!.today }}
      fields={[
        { name: "company_id", label: "Company", type: "select", required: true, options: mine.map((c) => ({ value: c.id, label: c.name })) },
        { name: "kind", label: "Type", type: "select", required: true, options: MOVES },
        { name: "bank_account_id", label: "From / account", type: "select", required: true, options: banks },
        { name: "to_bank_account_id", label: "To account", type: "select", required: true, options: banks, show: (v) => v.kind === "transfer" },
        { name: "base_amount", label: "Amount", type: "money", required: true }, { name: "txn_date", label: "Date", type: "date", required: true },
        { name: "reference", label: "Reference" }, { name: "description", label: "Note", type: "textarea", col: 12 },
      ]}
      transform={(o, k, val) => (k === "company_id" ? { ...o, company_id: val, bank_account_id: "", to_bank_account_id: "" } : { ...o, [k]: val })}
      onSubmit={async (v) => { await api("/transactions", { body: { ...v, company_id: +v.company_id, bank_account_id: +v.bank_account_id, to_bank_account_id: v.to_bank_account_id ? +v.to_bank_account_id : null, base_amount: Number(v.base_amount), tax_amount: 0 } }); toast("Posted"); onDone(); }}>
      {(v) => <div className="alert alert-info py-2 mt-3 mb-0 small">{v.kind === "transfer" ? "Internal transfers move money between your own accounts. They are never counted as income or expense." : v.kind === "capital" || v.kind === "drawing" ? "Capital and drawings are equity movements — they do not affect profit." : "Loan principal is a liability movement — it does not affect profit."}</div>}
    </FormModal>
  );
}

function Reconcile({ state, setState, onDone }: { state: any; setState: (s: any) => void; onDone: () => void }) {
  const { toast } = useApp(); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  if (!state) return null;
  const picked: Set<number> = state.picked;
  const cleared = state.reconciled_balance + state.lines.filter((l: any) => picked.has(l.id)).reduce((s: number, l: any) => s + l.debit - l.credit, 0);
  const diff = Number(state.statement_balance || 0) - cleared;
  const toggle = (id: number) => { const n = new Set(picked); n.has(id) ? n.delete(id) : n.add(id); setState({ ...state, picked: n }); };
  const save = async () => {
    setBusy(true); setErr("");
    try { await api("/reconcile", { body: { bank_account_id: state.account.id, statement_date: state.statement_date, statement_balance: Number(state.statement_balance), line_ids: [...picked] } }); toast(Math.abs(diff) < 0.005 ? "Reconciled — difference nil" : `Saved with a difference of ${inr(diff)}`, Math.abs(diff) < 0.005 ? "success" : "warning"); onDone(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal show onHide={() => setState(null)} size="xl" centered scrollable backdrop="static">
      <Modal.Header closeButton><Modal.Title className="fs-5">Bank reconciliation · {state.account.name}</Modal.Title></Modal.Header>
      <Modal.Body>
        <Row className="g-3 mb-3">
          <Col md={3}><Form.Label className="small fw-semibold">Statement date</Form.Label><Form.Control type="date" value={state.statement_date} onChange={(e) => setState({ ...state, statement_date: e.target.value })} /></Col>
          <Col md={3}><Form.Label className="small fw-semibold">Closing balance per statement</Form.Label><Form.Control type="number" step="0.01" value={state.statement_balance} onChange={(e) => setState({ ...state, statement_balance: e.target.value })} /></Col>
          <Col md={3}><div className="small text-secondary">Cleared balance (ticked)</div><div className="fs-5 fw-bold">{inr(cleared)}</div></Col>
          <Col md={3}><div className="small text-secondary">Difference</div><div className={`fs-5 fw-bold ${Math.abs(diff) < 0.005 ? "text-success" : "text-danger"}`}>{inr(diff)}</div></Col>
        </Row>
        <div className="text-secondary small mb-2">Tick every line that appears on the bank statement. Unticked lines stay open for the next reconciliation.</div>
        <table className="table table-sm align-middle"><thead><tr><th style={{ width: 40 }}><Form.Check checked={picked.size === state.lines.length && state.lines.length > 0} onChange={(e) => setState({ ...state, picked: e.target.checked ? new Set(state.lines.map((l: any) => l.id)) : new Set() })} /></th><th>Date</th><th>Entry</th><th>Narration</th><th className="text-end">In</th><th className="text-end">Out</th></tr></thead>
          <tbody>{state.lines.map((l: any) => <tr key={l.id} onClick={() => toggle(l.id)} style={{ cursor: "pointer" }}><td><Form.Check readOnly checked={picked.has(l.id)} /></td><td>{fmtDate(l.entry_date)}</td><td className="text-secondary small">{l.entry_no}</td><td>{l.memo}</td><td className="text-end">{l.debit ? inr(l.debit) : ""}</td><td className="text-end">{l.credit ? inr(l.credit) : ""}</td></tr>)}</tbody></table>
        {state.lines.length === 0 && <div className="text-center text-secondary py-5">Everything is reconciled.</div>}
        {err && <div className="alert alert-danger py-2 small">{err}</div>}
      </Modal.Body>
      <Modal.Footer><Button variant="light" onClick={() => setState(null)}>Cancel</Button><Button disabled={busy || !picked.size || state.statement_balance === ""} onClick={save}>{busy && <Spinner size="sm" className="me-2" />}Save reconciliation</Button></Modal.Footer>
    </Modal>
  );
}
void ReasonModal;
