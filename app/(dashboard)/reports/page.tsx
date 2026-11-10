"use client";
import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Badge, Button, Dropdown, Form, ListGroup } from "react-bootstrap";
import { useApp, useQuery } from "components/erp/AppProvider";
import { DateFilter, Empty, Loading, PageHeader, SectionCard, Status } from "components/erp/ui";
import { fmtDate, inr, qs } from "lib/client";

const REPORTS: { key: string; label: string; icon: string; group: string; filters: string[]; perm?: string }[] = [
  { key: "profit-loss", label: "Profit & Loss", icon: "ti-chart-line", group: "Statements", filters: ["range", "group"] },
  { key: "balance-sheet", label: "Balance Sheet", icon: "ti-scale", group: "Statements", filters: ["asof"] },
  { key: "cash-flow", label: "Cash Flow", icon: "ti-arrows-exchange", group: "Statements", filters: ["range"] },
  { key: "trial-balance", label: "Trial Balance", icon: "ti-list-numbers", group: "Statements", filters: ["asof"] },
  { key: "income", label: "Income Report", icon: "ti-arrow-down-left", group: "Activity", filters: ["range", "category:income"] },
  { key: "expense", label: "Expense Report", icon: "ti-arrow-up-right", group: "Activity", filters: ["range", "category:expense"] },
  { key: "receivables", label: "Receivables", icon: "ti-file-invoice", group: "Activity", filters: ["status"] },
  { key: "payables", label: "Payables", icon: "ti-receipt-2", group: "Activity", filters: ["status"] },
  { key: "tax", label: "Tax (GST & TDS)", icon: "ti-percentage", group: "Compliance", filters: ["range"] },
  { key: "payroll", label: "Payroll", icon: "ti-users-group", group: "Compliance", filters: ["range"], perm: "payroll.read" },
  { key: "budget-vs-actual", label: "Budget vs Actual", icon: "ti-target-arrow", group: "Management", filters: ["fy"] },
  { key: "company-comparison", label: "Company Comparison", icon: "ti-building-community", group: "Management", filters: ["range"] },
  { key: "by-project", label: "Product / Project / Course", icon: "ti-packages", group: "Management", filters: ["range"] },
  { key: "monthly", label: "Monthly Summary", icon: "ti-calendar-month", group: "Management", filters: ["range"] },
  { key: "annual", label: "Annual Summary", icon: "ti-calendar-stats", group: "Management", filters: [] },
];

function Inner() {
  const { meta, can, company, scope, toast } = useApp();
  const sp = useSearchParams(); const router = useRouter();
  const key = sp.get("r") || "profit-loss"; const def = REPORTS.find((r) => r.key === key)!;
  const [group, setGroup] = useState("company"); const [asOf, setAsOf] = useState(meta!.today); const [category, setCategory] = useState(""); const [status, setStatus] = useState(""); const [fy, setFy] = useState(meta!.fy);
  const params: Record<string, any> = {};
  if (def.filters.includes("group")) params.group = group;
  if (def.filters.includes("asof")) params.asOf = asOf;
  if (def.filters.some((f) => f.startsWith("category"))) params.category = category;
  if (def.filters.includes("status")) params.status = status;
  if (def.filters.includes("fy")) params.fy = fy;
  const needsRange = def.filters.includes("range");
  const { data: r, loading, error } = useQuery<any>(`/reports/${key}`, params, { scoped: true, range: needsRange });
  const exportUrl = (f: string) => `/api/reports/${key}/export${qs({ company, ...(needsRange ? scope : {}), ...params, format: f })}`;
  const catKind = def.filters.find((f) => f.startsWith("category"))?.split(":")[1];
  const cats = [...new Map(meta!.categories.filter((c) => c.kind === catKind && (company === "all" || String(c.company_id) === company)).map((c) => [c.name + c.company_id, c])).values()];
  const fmt = (v: any, kind?: string, status?: boolean) => {
    if (v == null || v === "") return "";
    if (kind === "money") return inr(v);
    if (kind === "pct") return `${Number(v).toFixed(1)}%`;
    if (kind === "date") return fmtDate(v);
    return String(v);
  };
  const groups = [...new Set(REPORTS.filter((x) => !x.perm || can(x.perm)).map((x) => x.group))];

  return (
    <>
      <PageHeader title="Financial Reports" subtitle="Every report is generated from posted ledger entries. Exports use exactly the filters shown."
        actions={<Dropdown align="end"><Dropdown.Toggle><i className="ti ti-download me-1" />Export</Dropdown.Toggle>
          <Dropdown.Menu><Dropdown.Item href={exportUrl("xlsx")}><i className="ti ti-file-spreadsheet me-2" />Excel (.xlsx)</Dropdown.Item><Dropdown.Item href={exportUrl("pdf")}><i className="ti ti-file-type-pdf me-2" />PDF</Dropdown.Item><Dropdown.Item href={exportUrl("csv")}><i className="ti ti-file-type-csv me-2" />CSV</Dropdown.Item></Dropdown.Menu></Dropdown>} />
      <div className="row g-4">
        <div className="col-12 d-xl-none">
          <Form.Select aria-label="Choose report" value={key} onChange={(e) => router.replace(`/reports?r=${e.target.value}`)}>
            {REPORTS.filter((x) => !x.perm || can(x.perm)).map((x) => <option key={x.key} value={x.key}>{x.group} · {x.label}</option>)}
          </Form.Select>
        </div>
        <div className="col-xl-3 d-none d-xl-block">
          <div className="card"><div className="card-body p-3">
            {groups.map((g) => (
              <div key={g} className="mb-2">
                <div className="text-secondary small fw-semibold px-3 py-2 text-uppercase">{g}</div>
                <ListGroup variant="flush">
                  {REPORTS.filter((x) => x.group === g && (!x.perm || can(x.perm))).map((x) => (
                    <ListGroup.Item key={x.key} action active={x.key === key} onClick={() => router.replace(`/reports?r=${x.key}`)} className="border-0 rounded-3 d-flex align-items-center gap-2 py-2"><i className={`ti ${x.icon}`} />{x.label}</ListGroup.Item>
                  ))}
                </ListGroup>
              </div>
            ))}
          </div></div>
        </div>
        <div className="col-xl-9">
          <SectionCard title={<><i className={`ti ${def.icon} me-2 text-primary`} />{def.label}</>} className="mb-0" actions={<span className="text-secondary small">{r?.subtitle}</span>}>
            <div className="d-flex flex-wrap gap-2 mb-4 align-items-center">
              {needsRange && <DateFilter />}
              {def.filters.includes("asof") && <><span className="small text-secondary">As of</span><Form.Control size="sm" type="date" style={{ width: 150 }} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></>}
              {def.filters.includes("group") && <Form.Select size="sm" style={{ width: 190 }} value={group} onChange={(e) => setGroup(e.target.value)}><option value="company">Company-wise (+ consolidated)</option><option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="year">Annual (FY)</option></Form.Select>}
              {catKind && <Form.Select size="sm" style={{ width: 200 }} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Form.Select>}
              {def.filters.includes("status") && <Form.Select size="sm" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="unpaid">Unpaid</option><option value="partially_paid">Partially paid</option><option value="overdue">Overdue</option><option value="paid">Paid</option></Form.Select>}
              {def.filters.includes("fy") && <Form.Select size="sm" style={{ width: 140 }} value={fy} onChange={(e) => setFy(e.target.value)}>{["2024-25", "2025-26", "2026-27", "2027-28"].map((f) => <option key={f}>{f}</option>)}</Form.Select>}
            </div>
            {r?.meta && "balanced" in r.meta && <Badge bg={r.meta.balanced ? "success-subtle" : "danger-subtle"} text={r.meta.balanced ? "success-emphasis" : "danger-emphasis"} className="mb-3"><i className={`ti ${r.meta.balanced ? "ti-circle-check" : "ti-alert-triangle"} me-1`} />{key === "balance-sheet" ? (r.meta.balanced ? "Assets = Liabilities + Equity ✓" : `Out of balance by ${inr(r.meta.difference)}`) : r.meta.balanced ? "Debits = Credits ✓" : "Debits ≠ Credits"}</Badge>}
            {r?.meta && "reconciles" in r.meta && <Badge bg={r.meta.reconciles ? "success-subtle" : "danger-subtle"} text={r.meta.reconciles ? "success-emphasis" : "danger-emphasis"} className="mb-3"><i className="ti ti-circle-check me-1" />{r.meta.reconciles ? "Closing balance agrees with ledger cash & bank ✓" : "Does not reconcile"}</Badge>}
            {r?.meta?.outstanding != null && <Badge bg="warning-subtle" text="warning-emphasis" className="mb-3 fs-6">Total outstanding {inr(r.meta.outstanding)}</Badge>}
            {r?.meta?.total != null && <Badge bg="primary-subtle" text="primary-emphasis" className="mb-3 fs-6">Total {inr(r.meta.total)}</Badge>}
            {error && <div className="alert alert-danger">{error}</div>}
            {loading && !r ? <Loading /> : r && r.rows.length === 0 ? <Empty text="No data for the selected filters" /> : r && (
              <div className="table-responsive" style={{ maxHeight: "68vh" }}>
                <table className="table table-sm align-middle mb-0">
                  <thead className="sticky-top"><tr>{r.columns.map((c: any) => <th key={c.key} className={`${["money", "pct", "int"].includes(c.kind) ? "text-end" : ""} text-nowrap`}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {r.rows.map((row: any, i: number) => {
                      const st = row._style || ""; const bold = ["total", "grand", "sub", "head"].includes(st);
                      return (
                        <tr key={i} className={st === "grand" ? "table-active" : st === "head" ? "bg-body-tertiary" : ""}>
                          {r.columns.map((c: any, ci: number) => (
                            <td key={c.key} className={`${["money", "pct", "int"].includes(c.kind) ? "text-end" : ""} ${bold ? "fw-semibold" : ""} ${c.kind === "money" && Number(row[c.key]) < 0 ? "text-danger" : ""}`} style={{ fontVariantNumeric: "tabular-nums", paddingLeft: ci === 0 && row._level ? 12 + row._level * 18 : undefined }}>
                              {c.key === "status" && row.status ? <Status value={row.status} /> : st === "head" && ci > 0 ? "" : fmt(row[c.key], c.kind)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {key === "tax" && <div className="alert alert-warning py-2 mt-4 mb-0 small"><i className="ti ti-info-circle me-1" />These are computed summaries to help your accountant prepare returns. This system does not file GST returns or connect to the GST portal — verify figures before filing.</div>}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
export default function Reports() { return <Suspense><Inner /></Suspense>; }
