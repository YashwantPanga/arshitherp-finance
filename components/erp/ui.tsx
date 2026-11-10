"use client";
import dynamic from "next/dynamic";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardBody, Col, Form, Modal, Row, Spinner } from "react-bootstrap";
import { STATUS_STYLE, inr } from "lib/client";
import { PRESETS, Preset, useApp } from "./AppProvider";

const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false, loading: () => <div className="text-center text-secondary py-6"><Spinner size="sm" /></div> });

export const PALETTE = ["#00a76f", "#2065d1", "#ff9f1a", "#7a4cd6", "#ff5630", "#00b8d9", "#637381", "#c2185b"];

export function Chart({ type, series, options, height = 300 }: { type: "area" | "line" | "bar" | "donut" | "pie" | "radialBar"; series: any; options?: any; height?: number }) {
  const { dark } = useApp();
  const base = {
    chart: { toolbar: { show: false }, fontFamily: "inherit", background: "transparent", zoom: { enabled: false } },
    theme: { mode: dark ? "dark" : "light" },
    colors: PALETTE, dataLabels: { enabled: false }, stroke: { curve: "smooth", width: 2.5 },
    grid: { borderColor: dark ? "#2d3a47" : "#eef1f4", strokeDashArray: 4 },
    legend: { position: "top", horizontalAlign: "right", markers: { size: 6 }, fontSize: "12px" },
    tooltip: { theme: dark ? "dark" : "light" },
    xaxis: { axisBorder: { show: false }, axisTicks: { show: false }, labels: { style: { fontSize: "11px" } } },
    yaxis: { labels: { style: { fontSize: "11px" } } },
  };
  const merged = useMemo(() => deepMerge(base, options || {}), [dark, options]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ApexChart key={String(dark)} type={type} series={series} options={merged} height={height} />;
}
function deepMerge(a: any, b: any): any {
  if (Array.isArray(b) || typeof b !== "object" || b === null) return b;
  const o = { ...a };
  for (const k of Object.keys(b)) o[k] = k in a && typeof a[k] === "object" && !Array.isArray(a[k]) ? deepMerge(a[k], b[k]) : b[k];
  return o;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-6">
      <div>
        <h1 className="mb-1 fs-3">{title}</h1>
        {subtitle && <div className="text-secondary">{subtitle}</div>}
      </div>
      <div className="d-flex flex-wrap gap-2 align-items-center">{actions}</div>
    </div>
  );
}

export function Status({ value, label }: { value: string; label?: string }) {
  const [c, l] = STATUS_STYLE[value] || ["secondary", value];
  return <Badge bg={`${c}-subtle`} text={`${c}-emphasis`} className="fw-semibold">{label || l}</Badge>;
}

export const Money = ({ v, bold, className = "" }: { v: number | string | null | undefined; bold?: boolean; className?: string }) => (
  <span className={`${bold ? "fw-semibold" : ""} ${Number(v) < 0 ? "text-danger" : ""} ${className}`} style={{ fontVariantNumeric: "tabular-nums" }}>{inr(v)}</span>
);

const GRADS = ["bg-gradient-success", "bg-gradient-info", "bg-gradient-warning", "bg-gradient-danger"];
const TXT = ["text-success-emphasis", "text-info-emphasis", "text-warning-emphasis", "text-danger-emphasis"];
export function StatCard({ title, value, icon, tone = 0, sub, trend, loading }: { title: string; value: ReactNode; icon: string; tone?: number; sub?: ReactNode; trend?: { pct: number; good: "up" | "down"; label?: string }; loading?: boolean }) {
  const up = (trend?.pct ?? 0) >= 0, good = trend ? (trend.good === "up" ? up : !up) : true;
  return (
    <Card className={`card-lg h-100 ${GRADS[tone % 4]}`}>
      <CardBody className="d-flex flex-column gap-3">
        <div className="d-flex justify-content-between align-items-center">
          <div className="fw-semibold">{title}</div>
          <i className={`ti ${icon} fs-3 ${TXT[tone % 4]}`} />
        </div>
        <div className="fs-3 fw-bold lh-1 text-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>{loading ? <Spinner size="sm" /> : value}</div>
        <div className="small d-flex flex-wrap gap-2 align-items-center">
          {trend && (
            <span className={`fw-semibold ${good ? "text-success" : "text-danger"}`}>
              <i className={`ti ${up ? "ti-trending-up" : "ti-trending-down"} me-1`} />{up ? "+" : ""}{trend.pct.toFixed(1)}%
            </span>
          )}
          <span className="text-secondary">{sub}</span>
        </div>
      </CardBody>
    </Card>
  );
}

export function Empty({ text = "Nothing here yet", icon = "ti-inbox" }: { text?: string; icon?: string }) {
  return <div className="text-center text-secondary py-8"><i className={`ti ${icon} fs-1 d-block mb-2 opacity-50`} />{text}</div>;
}
export const Loading = () => <div className="text-center text-secondary py-8"><Spinner size="sm" className="me-2" />Loading…</div>;

export interface Column<T> { key: string; header: ReactNode; render?: (r: T) => ReactNode; align?: "start" | "end" | "center"; width?: number | string; hideMobile?: boolean }
export function DataTable<T extends Record<string, any>>({ cols, rows, loading, empty, onRow, page, pageSize, total, onPage, dense }: {
  cols: Column<T>[]; rows: T[] | null | undefined; loading?: boolean; empty?: string; onRow?: (r: T) => void;
  page?: number; pageSize?: number; total?: number; onPage?: (p: number) => void; dense?: boolean;
}) {
  const pages = total && pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return (
    <>
      <div className="table-responsive">
        <table className={`table table-hover align-middle mb-0 ${dense ? "table-sm" : ""}`}>
          <thead><tr>{cols.map((c) => <th key={c.key} className={`${c.align ? "text-" + c.align : ""} ${c.hideMobile ? "d-none d-lg-table-cell" : ""} text-nowrap`} style={{ width: c.width }}>{c.header}</th>)}</tr></thead>
          <tbody>
            {rows?.map((r, i) => (
              <tr key={(r as any).id ?? i} onClick={onRow ? () => onRow(r) : undefined} style={onRow ? { cursor: "pointer" } : undefined}>
                {cols.map((c) => <td key={c.key} className={`text-nowrap ${c.align ? "text-" + c.align : ""} ${c.hideMobile ? "d-none d-lg-table-cell" : ""}`}>{c.render ? c.render(r) : (r[c.key] ?? "—")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && !rows?.length && <Loading />}
      {!loading && !rows?.length && <Empty text={empty} />}
      {onPage && total ? (
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 p-4 border-top">
          <span className="text-secondary small">{total.toLocaleString("en-IN")} records · page {page} of {pages}</span>
          <div className="d-flex gap-1">
            <Button size="sm" variant="outline-secondary" disabled={(page || 1) <= 1} onClick={() => onPage((page || 1) - 1)}><i className="ti ti-chevron-left" /></Button>
            <Button size="sm" variant="outline-secondary" disabled={(page || 1) >= pages} onClick={() => onPage((page || 1) + 1)}><i className="ti ti-chevron-right" /></Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------- forms ----------
export interface FieldDef {
  name: string; label: string; type?: "text" | "number" | "date" | "select" | "textarea" | "checkbox" | "email" | "password" | "money";
  options?: { value: string | number; label: string }[] | ((v: any) => { value: string | number; label: string }[]);
  required?: boolean; col?: number; hint?: string; show?: (v: any) => boolean; placeholder?: string; disabled?: boolean | ((v: any) => boolean); step?: string; min?: number;
}
export function Fields({ fields, values, set }: { fields: FieldDef[]; values: any; set: (k: string, v: any) => void }) {
  return (
    <Row className="g-3">
      {fields.filter((f) => !f.show || f.show(values)).map((f) => {
        const opts = typeof f.options === "function" ? f.options(values) : f.options;
        const dis = typeof f.disabled === "function" ? f.disabled(values) : f.disabled;
        return (
          <Col key={f.name} md={f.col || 6}>
            {f.type === "checkbox" ? (
              <Form.Check type="switch" id={"f-" + f.name} label={f.label} checked={!!values[f.name]} disabled={dis} onChange={(e) => set(f.name, e.target.checked)} className="mt-4" />
            ) : (
              <>
                <Form.Label className="small fw-semibold mb-1">{f.label}{f.required && <span className="text-danger"> *</span>}</Form.Label>
                {f.type === "select" ? (
                  <Form.Select value={values[f.name] ?? ""} disabled={dis} onChange={(e) => set(f.name, e.target.value)}>
                    <option value="">Select…</option>
                    {opts?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Form.Select>
                ) : f.type === "textarea" ? (
                  <Form.Control as="textarea" rows={2} value={values[f.name] ?? ""} disabled={dis} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
                ) : (
                  <Form.Control type={f.type === "money" ? "number" : f.type || "text"} step={f.type === "money" ? "0.01" : f.step} min={f.type === "money" ? 0 : f.min} value={values[f.name] ?? ""} disabled={dis} placeholder={f.placeholder}
                    onChange={(e) => set(f.name, e.target.value)} />
                )}
                {f.hint && <Form.Text className="text-secondary">{f.hint}</Form.Text>}
              </>
            )}
          </Col>
        );
      })}
    </Row>
  );
}

export function FormModal({ show, title, fields, initial, onSubmit, onClose, submitLabel = "Save", size = "lg", footerExtra, children, transform }: {
  show: boolean; title: string; fields: FieldDef[]; initial: any; onSubmit: (v: any) => Promise<any>; onClose: () => void; submitLabel?: string; size?: "sm" | "lg" | "xl";
  footerExtra?: ReactNode; children?: (v: any, set: (k: string, v: any) => void) => ReactNode; transform?: (v: any, k: string, val: any) => any;
}) {
  const [values, setValues] = useState<any>(initial);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { if (show) { setValues(initial); setErr(""); } }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: any) => setValues((o: any) => (transform ? transform(o, k, v) : { ...o, [k]: v }));
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (busy) return;
    for (const f of fields) if (f.required && (!f.show || f.show(values)) && (values[f.name] === "" || values[f.name] == null)) { setErr(`${f.label} is required`); return; }
    setBusy(true); setErr("");
    try { await onSubmit(values); } catch (e: any) { setErr(e.message || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Modal show={show} onHide={busy ? undefined : onClose} size={size} centered backdrop="static" scrollable>
      <Form onSubmit={submit}>
        <Modal.Header closeButton><Modal.Title className="fs-5">{title}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Fields fields={fields} values={values} set={set} />
          {children?.(values, set)}
          {err && <div className="alert alert-danger py-2 mt-4 mb-0 small"><i className="ti ti-alert-circle me-1" />{err}</div>}
        </Modal.Body>
        <Modal.Footer>
          {footerExtra}
          <Button variant="light" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy && <Spinner size="sm" className="me-2" />}{submitLabel}</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

/** Confirmation / reason prompt used for destructive actions (void, delete). */
export function ReasonModal({ show, title, message, needReason = true, confirmLabel = "Confirm", danger = true, onConfirm, onClose }: {
  show: boolean; title: string; message?: ReactNode; needReason?: boolean; confirmLabel?: string; danger?: boolean; onConfirm: (reason: string) => Promise<any>; onClose: () => void;
}) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { if (show) { setReason(""); setErr(""); } }, [show]);
  const go = async () => {
    if (needReason && reason.trim().length < 3) { setErr("Please give a reason (min 3 characters)"); return; }
    setBusy(true); try { await onConfirm(reason); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal show={show} onHide={busy ? undefined : onClose} centered backdrop="static">
      <Modal.Header closeButton><Modal.Title className="fs-5">{title}</Modal.Title></Modal.Header>
      <Modal.Body>
        {message && <p className="text-secondary">{message}</p>}
        {needReason && <Form.Control as="textarea" rows={2} placeholder="Reason (kept in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
        {err && <div className="alert alert-danger py-2 mt-3 mb-0 small">{err}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="light" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={go} disabled={busy}>{busy && <Spinner size="sm" className="me-2" />}{confirmLabel}</Button>
      </Modal.Footer>
    </Modal>
  );
}

/** Date range selector shared by the dashboard, lists and reports. */
export function DateFilter({ compact }: { compact?: boolean }) {
  const { preset, from, to, setRange } = useApp();
  return (
    <div className="d-flex flex-wrap gap-2 align-items-center">
      <Form.Select size="sm" style={{ width: compact ? 150 : 180 }} value={preset} onChange={(e) => setRange(e.target.value as Preset, from, to)} aria-label="Date range">
        {PRESETS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
      </Form.Select>
      {preset === "custom" && (
        <>
          <Form.Control size="sm" type="date" style={{ width: 140 }} value={from} onChange={(e) => setRange("custom", e.target.value, to)} aria-label="From" />
          <span className="text-secondary small">to</span>
          <Form.Control size="sm" type="date" style={{ width: 140 }} value={to} onChange={(e) => setRange("custom", from, e.target.value)} aria-label="To" />
        </>
      )}
    </div>
  );
}

export function SectionCard({ title, actions, children, className = "", flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <Card className={`mb-6 ${className}`}>
      {title && <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 px-5 pt-5 pb-3"><h2 className="fs-5 mb-0">{title}</h2><div className="d-flex gap-2 align-items-center">{actions}</div></div>}
      <CardBody className={flush ? "p-0" : ""}>{children}</CardBody>
    </Card>
  );
}

export const companyColor = (meta: any, id: number, i = 0) => meta?.companies.find((c: any) => c.id === id)?.brand_color || PALETTE[i % PALETTE.length];
