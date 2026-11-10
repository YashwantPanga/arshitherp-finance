"use client";
import Link from "next/link";
import { Col, Row } from "react-bootstrap";
import { useApp, useQuery } from "components/erp/AppProvider";
import { Chart, DataTable, DateFilter, Empty, Money, PageHeader, PALETTE, SectionCard, StatCard, Status } from "components/erp/ui";
import { fmtDate, fmtMonth, inr, inr0, inrShort } from "lib/client";

const ICONS: Record<string, [string, number]> = {
  revenue: ["ti-trending-up", 0], expenses: ["ti-credit-card", 3], profit: ["ti-coins", 0], cash: ["ti-cash", 2],
  bank: ["ti-building-bank", 1], ar: ["ti-file-invoice", 1], ap: ["ti-receipt-2", 2], growth: ["ti-chart-arrows-vertical", 0],
};

export default function Dashboard() {
  const { meta, companyName } = useApp();
  const { data: d, loading, error } = useQuery<any>("/dashboard");
  const months = d?.series.map((s: any) => fmtMonth(s.month)) || [];
  const colors = (d?.companies || []).map((c: any, i: number) => meta?.companies.find((x) => x.id === c.id)?.brand_color || PALETTE[i]);
  const axisMoney = { labels: { formatter: (v: number) => inrShort(v) } };
  const tip = { y: { formatter: (v: number) => inr(v) } };

  return (
    <>
      <PageHeader
        title="Financial Overview"
        subtitle={<>{companyName} · {d ? `${fmtDate(d.range.from)} – ${fmtDate(d.range.to)}` : "…"} · compared with the previous equal period</>}
        actions={<DateFilter />}
      />
      {error && <div className="alert alert-danger">{error}</div>}

      <Row className="g-4 mb-6">
        {d?.kpis.map((k: any) => (
          <Col key={k.key} xl={3} md={6}>
            <StatCard
              title={k.label} tone={ICONS[k.key][1]} icon={ICONS[k.key][0]}
              value={k.isPct ? `${k.value >= 0 ? "+" : ""}${k.value.toFixed(1)}%` : inr0(k.value)}
              trend={{ pct: k.changePct, good: k.good }}
              sub={k.isPct ? <>This month {inrShort(k.thisMonth)} vs {inrShort(k.previous)}</> : <>Previous {inrShort(k.previous)}</>}
            />
          </Col>
        )) || Array.from({ length: 8 }).map((_, i) => <Col key={i} xl={3} md={6}><StatCard title="…" value="" icon="ti-loader" tone={i} loading /></Col>)}
      </Row>

      <Row className="g-4 mb-6">
        <Col xl={8}>
          <SectionCard title="Revenue vs Expenses" className="h-100 mb-0">
            {d ? <Chart type="bar" height={320} series={[{ name: "Revenue", data: d.series.map((s: any) => s.revenue) }, { name: "Expenses", data: d.series.map((s: any) => s.expenses) }]}
              options={{ xaxis: { categories: months }, yaxis: axisMoney, tooltip: tip, plotOptions: { bar: { columnWidth: "46%", borderRadius: 4 } }, colors: [PALETTE[0], PALETTE[4]] }} /> : null}
          </SectionCard>
        </Col>
        <Col xl={4}>
          <SectionCard title="Revenue by company" className="h-100 mb-0">
            {d?.companies.some((c: any) => c.income > 0) ? <Chart type="donut" height={320} series={d.companies.map((c: any) => c.income)}
              options={{ labels: d.companies.map((c: any) => c.name), colors, tooltip: tip, legend: { position: "bottom" }, plotOptions: { pie: { donut: { size: "68%", labels: { show: true, total: { show: true, label: "Revenue", formatter: () => inrShort(d.companies.reduce((s: number, c: any) => s + c.income, 0)) } } } } } }} /> : <Empty text="No revenue in this period" />}
          </SectionCard>
        </Col>
      </Row>

      <Row className="g-4 mb-6">
        <Col xl={6}>
          <SectionCard title="Monthly profit trend" className="h-100 mb-0">
            {d && <Chart type="area" height={280} series={[{ name: "Net profit", data: d.series.map((s: any) => s.profit) }]}
              options={{ xaxis: { categories: months }, yaxis: axisMoney, tooltip: tip, colors: [PALETTE[1]], fill: { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.02 } }, legend: { show: false } }} />}
          </SectionCard>
        </Col>
        <Col xl={6}>
          <SectionCard title="Cash flow overview" className="h-100 mb-0">
            {d && <Chart type="bar" height={280} series={[
              { name: "Operating", type: "bar", data: d.cashSeries.map((s: any) => s.operating) },
              { name: "Investing", type: "bar", data: d.cashSeries.map((s: any) => s.investing) },
              { name: "Financing", type: "bar", data: d.cashSeries.map((s: any) => s.financing) },
              { name: "Net", type: "line", data: d.cashSeries.map((s: any) => +(s.operating + s.investing + s.financing).toFixed(2)) }]}
              options={{ chart: { stacked: false }, xaxis: { categories: months }, yaxis: axisMoney, tooltip: tip, colors: [PALETTE[0], PALETTE[2], PALETTE[3], "#212b36"], stroke: { width: [0, 0, 0, 3] }, plotOptions: { bar: { columnWidth: "55%", borderRadius: 3 } } }} />}
          </SectionCard>
        </Col>
      </Row>

      <Row className="g-4 mb-6">
        <Col xl={7}>
          <SectionCard title="Company-wise profit comparison" className="h-100 mb-0">
            {d && <Chart type="bar" height={300} series={[{ name: "Revenue", data: d.companies.map((c: any) => c.income) }, { name: "Expenses", data: d.companies.map((c: any) => c.expenses) }, { name: "Net profit", data: d.companies.map((c: any) => c.net) }]}
              options={{ xaxis: { categories: d.companies.map((c: any) => c.name) }, yaxis: axisMoney, tooltip: tip, colors: [PALETTE[0], PALETTE[4], PALETTE[1]], plotOptions: { bar: { columnWidth: "55%", borderRadius: 4 } } }} />}
          </SectionCard>
        </Col>
        <Col xl={5}>
          <SectionCard title="Expense category breakdown" className="h-100 mb-0">
            {d?.expenseByCategory.length ? <Chart type="donut" height={300} series={d.expenseByCategory.map((c: any) => c.value)}
              options={{ labels: d.expenseByCategory.map((c: any) => c.name), tooltip: tip, legend: { position: "right", fontSize: "11px" }, plotOptions: { pie: { donut: { size: "62%" } } } }} /> : <Empty text="No expenses in this period" />}
          </SectionCard>
        </Col>
      </Row>

      <Row className="g-4">
        <Col xl={7}>
          <SectionCard title="Company summary" flush className="mb-0">
            <DataTable rows={d?.companies} loading={loading} cols={[
              { key: "name", header: "Company", render: (c: any) => <span className="fw-semibold">{c.name}</span> },
              { key: "income", header: "Revenue", align: "end", render: (c: any) => <Money v={c.income} /> },
              { key: "expenses", header: "Expenses", align: "end", render: (c: any) => <Money v={c.expenses} /> },
              { key: "net", header: "Net profit", align: "end", render: (c: any) => <Money v={c.net} bold /> },
              { key: "m", header: "Margin", align: "end", hideMobile: true, render: (c: any) => (c.income ? `${((c.net / c.income) * 100).toFixed(1)}%` : "—") },
            ]} />
          </SectionCard>
        </Col>
        <Col xl={5}>
          <SectionCard title="Needs attention" className="mb-0">
            {d && (
              <div className="d-flex flex-column gap-3">
                <Link href="/receivables?status=overdue" className="d-flex justify-content-between"><span><i className="ti ti-alarm text-danger me-2" />Overdue invoices ({d.alerts.overdueInvoices.n})</span><Money v={d.alerts.overdueInvoices.amt} bold /></Link>
                <Link href="/expenses?status=pending_approval" className="d-flex justify-content-between"><span><i className="ti ti-hourglass text-warning me-2" />Expenses awaiting approval ({d.alerts.pendingApprovals.n})</span><Money v={d.alerts.pendingApprovals.amt} bold /></Link>
                {d.alerts.budgetWarnings.map((b: any) => <Link href="/budgets" key={b.id} className="d-flex justify-content-between"><span><i className="ti ti-target-arrow text-danger me-2" />{b.company} · {b.category}</span><span className="fw-semibold text-danger">{Number(b.utilization).toFixed(0)}%</span></Link>)}
                <hr className="my-1" />
                <div className="fw-semibold small text-secondary">UPCOMING &amp; OVERDUE BILLS</div>
                {d.alerts.upcomingBills.length === 0 && <div className="text-secondary small">No bills due in the next 14 days.</div>}
                {d.alerts.upcomingBills.map((b: any) => (
                  <div key={b.bill_no} className="d-flex justify-content-between align-items-center">
                    <div><div className="fw-semibold small">{b.vendor}</div><div className="text-secondary small">{b.bill_no} · due {fmtDate(b.due_date)}</div></div>
                    <div className="text-end"><Money v={b.balance} bold /><div><Status value={b.status} /></div></div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </Col>
      </Row>
    </>
  );
}
