"use client";
// Browser-side helpers: API calls and consistent INR / date formatting.

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(url: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const res = await fetch("/api" + url, {
    method: opts.method || (opts.body || opts.form ? "POST" : "GET"),
    headers: opts.form ? undefined : opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    credentials: "same-origin",
  });
  if (res.status === 401 && !url.startsWith("/auth/")) {
    if (typeof window !== "undefined" && !location.pathname.startsWith("/sign-in")) location.href = "/sign-in";
    throw new ApiError(401, "Session expired");
  }
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || "Request failed");
  return data as T;
}

export const qs = (o: Record<string, any>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "" && v !== "all-none") p.set(k, String(v)); });
  const s = p.toString();
  return s ? "?" + s : "";
};

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const INR0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const inr = (n: number | string | null | undefined) => INR.format(Number(n || 0));
export const inr0 = (n: number | string | null | undefined) => INR0.format(Number(n || 0));
/** Compact Indian formatting: ₹1.25 Cr, ₹3.4 L, ₹12.5 K */
export function inrShort(n: number | string | null | undefined) {
  const v = Number(n || 0), a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)} K`;
  return `${s}₹${a.toFixed(0)}`;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (s?: string | null) => (s ? `${s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : "—");
export const fmtMonth = (m: string) => `${MON[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;
export const fmtTs = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

export const STATUS_STYLE: Record<string, [string, string]> = {
  paid: ["success", "Paid"], partially_paid: ["warning", "Partially Paid"], unpaid: ["secondary", "Unpaid"], overdue: ["danger", "Overdue"],
  draft: ["secondary", "Draft"], pending_approval: ["warning", "Pending Approval"], posted: ["success", "Posted"], voided: ["dark", "Voided"],
  open: ["success", "Open"], closed: ["dark", "Closed"], received: ["success", "Received"], pending: ["warning", "Pending"],
  paid_: ["success", "Paid"],
};
