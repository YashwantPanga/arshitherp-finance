"use client";
import Link from "next/link";
import { Dropdown } from "react-bootstrap";
import React from "react";
import { useQuery } from "components/erp/AppProvider";
import { inr, fmtDate } from "lib/client";

const T = React.forwardRef<HTMLButtonElement, any>(({ children, onClick }, ref) => (
  <button ref={ref} className="btn btn-ghost btn-icon rounded-circle position-relative" onClick={onClick} aria-label="Alerts">{children}</button>
));
T.displayName = "T";

export default function AlertsBell() {
  const { data } = useQuery<any>("/dashboard", { preset: "month" }, { scoped: true, range: false });
  const a = data?.alerts;
  const n = (a?.overdueInvoices?.n > 0 ? 1 : 0) + (a?.pendingApprovals?.n > 0 ? 1 : 0) + (a?.upcomingBills?.length || 0) + (a?.budgetWarnings?.length || 0);
  return (
    <Dropdown align="end">
      <Dropdown.Toggle as={T}>
        <i className="ti ti-bell fs-5" />
        {n > 0 && <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger mt-2 ms-n2">{n}</span>}
      </Dropdown.Toggle>
      <Dropdown.Menu className="p-0" style={{ width: 340 }}>
        <div className="px-4 py-3 border-bottom fw-semibold">Alerts</div>
        <div className="p-2" style={{ maxHeight: 380, overflowY: "auto" }}>
          {!n && <div className="text-secondary text-center py-5 small">You&apos;re all caught up</div>}
          {a?.overdueInvoices?.n > 0 && <Dropdown.Item as={Link} href="/receivables?status=overdue" className="d-flex gap-3 py-2"><i className="ti ti-alarm text-danger fs-4" /><div><div className="fw-semibold small">{a.overdueInvoices.n} overdue invoice(s)</div><div className="text-secondary small">{inr(a.overdueInvoices.amt)} to collect</div></div></Dropdown.Item>}
          {a?.pendingApprovals?.n > 0 && <Dropdown.Item as={Link} href="/expenses?status=pending_approval" className="d-flex gap-3 py-2"><i className="ti ti-hourglass text-warning fs-4" /><div><div className="fw-semibold small">{a.pendingApprovals.n} expense(s) await approval</div><div className="text-secondary small">{inr(a.pendingApprovals.amt)}</div></div></Dropdown.Item>}
          {a?.upcomingBills?.map((b: any) => <Dropdown.Item as={Link} href="/payables" key={b.bill_no} className="d-flex gap-3 py-2"><i className="ti ti-receipt-2 text-info fs-4" /><div><div className="fw-semibold small">{b.vendor} · {inr(b.balance)}</div><div className="text-secondary small">{b.status === "overdue" ? "Overdue since" : "Due"} {fmtDate(b.due_date)}</div></div></Dropdown.Item>)}
          {a?.budgetWarnings?.map((b: any) => <Dropdown.Item as={Link} href="/budgets" key={b.id} className="d-flex gap-3 py-2"><i className="ti ti-target-arrow text-danger fs-4" /><div><div className="fw-semibold small">{b.company}: {b.category} at {Number(b.utilization).toFixed(0)}%</div><div className="text-secondary small">{b.status}</div></div></Dropdown.Item>)}
        </div>
      </Dropdown.Menu>
    </Dropdown>
  );
}
