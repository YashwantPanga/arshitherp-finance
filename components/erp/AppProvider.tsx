"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Toast, ToastContainer } from "react-bootstrap";
import { api, qs } from "lib/client";

export interface Meta {
  user: { id: number; name: string; email: string; role: string; perms: string[]; companyIds: number[] };
  companies: any[]; banks: any[]; categories: any[]; customers: any[]; vendors: any[]; employees: any[]; periods: any[]; today: string; fy: string;
}
export type Preset = "today" | "week" | "month" | "last_month" | "quarter" | "fy" | "custom";
export const PRESETS: { v: Preset; label: string }[] = [
  { v: "today", label: "Today" }, { v: "week", label: "This Week" }, { v: "month", label: "This Month" }, { v: "last_month", label: "Last Month" },
  { v: "quarter", label: "This Quarter" }, { v: "fy", label: "This Financial Year" }, { v: "custom", label: "Custom Range" },
];

interface Ctx {
  meta: Meta | null; company: string; setCompany: (c: string) => void;
  preset: Preset; from: string; to: string; setRange: (p: Preset, from?: string, to?: string) => void;
  can: (perm: string) => boolean; reload: () => Promise<void>; toast: (msg: string, kind?: "success" | "danger" | "warning") => void;
  scope: Record<string, string>; companyName: string; dark: boolean; toggleDark: () => void;
}
const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [company, setCompanyS] = useState("all");
  const [preset, setPreset] = useState<Preset>("fy");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const [dark, setDark] = useState(false);
  const router = useRouter(); const path = usePathname(); const seq = useRef(0);

  const reload = useCallback(async () => {
    try { setMeta(await api<Meta>("/meta")); } catch { router.replace("/sign-in"); }
  }, [router]);

  useEffect(() => {
    try {
      const c = localStorage.getItem("erp.company"); if (c) setCompanyS(c);
      const p = localStorage.getItem("erp.preset") as Preset; if (p) setPreset(p);
      setFrom(localStorage.getItem("erp.from") || ""); setTo(localStorage.getItem("erp.to") || "");
      const d = localStorage.getItem("erp.dark") === "1"; setDark(d); document.documentElement.setAttribute("data-bs-theme", d ? "dark" : "light");
    } catch {}
    reload();
  }, [reload]);

  // a company admin who only has one company must never see "all"
  useEffect(() => {
    if (!meta) return;
    if (company !== "all" && !meta.companies.some((c) => String(c.id) === company)) setCompanyS("all");
  }, [meta, company]);

  const setCompany = (c: string) => { setCompanyS(c); try { localStorage.setItem("erp.company", c); } catch {} };
  const setRange = (p: Preset, f = "", t = "") => { setPreset(p); setFrom(f); setTo(t); try { localStorage.setItem("erp.preset", p); localStorage.setItem("erp.from", f); localStorage.setItem("erp.to", t); } catch {} };
  const toggleDark = () => { const d = !dark; setDark(d); document.documentElement.setAttribute("data-bs-theme", d ? "dark" : "light"); try { localStorage.setItem("erp.dark", d ? "1" : "0"); } catch {} };
  const toast = useCallback((msg: string, kind: "success" | "danger" | "warning" = "success") => { const id = ++seq.current; setToasts((t) => [...t, { id, msg, kind }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500); }, []);
  const can = useCallback((p: string) => !!meta?.user.perms.includes(p), [meta]);
  const scope = useMemo<Record<string, string>>(() => { const o: Record<string, string> = { company, preset }; if (preset === "custom") { o.from = from; o.to = to; } return o; }, [company, preset, from, to]);
  const companyName = company === "all" ? "All Companies" : meta?.companies.find((c) => String(c.id) === company)?.name || "";
  void path; void qs;

  return (
    <C.Provider value={{ meta, company, setCompany, preset, from, to, setRange, can, reload, toast, scope, companyName, dark, toggleDark }}>
      {meta ? children : <div className="vh-100 d-flex align-items-center justify-content-center text-secondary"><div className="spinner-border text-primary me-3" /> Loading workspace…</div>}
      <ToastContainer position="bottom-end" className="p-4" style={{ zIndex: 2000 }}>
        {toasts.map((t) => (
          <Toast key={t.id} bg={t.kind === "danger" ? "danger" : t.kind === "warning" ? "warning" : "dark"} onClose={() => setToasts((x) => x.filter((y) => y.id !== t.id))} show>
            <Toast.Body className="text-white d-flex gap-2 align-items-start"><i className={`ti ${t.kind === "danger" ? "ti-alert-circle" : "ti-circle-check"} fs-5`} /> <span>{t.msg}</span></Toast.Body>
          </Toast>
        ))}
      </ToastContainer>
    </C.Provider>
  );
}

/** Fetch + auto-refetch whenever company / date range / extra deps change. */
export function useQuery<T = any>(path: string | null, extra: Record<string, any> = {}, opts: { scoped?: boolean; range?: boolean } = { scoped: true, range: true }) {
  const { scope, company } = useApp();
  const [data, setData] = useState<T | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const key = JSON.stringify([path, extra, opts.scoped ? company : "", opts.range ? scope : ""]);
  const tick = useRef(0);
  const run = useCallback(async () => {
    if (!path) return;
    const my = ++tick.current; setLoading(true);
    try {
      const params = { ...(opts.scoped === false ? {} : opts.range === false ? { company } : scope), ...extra };
      const d = await api<T>(path + qs(params)); if (my === tick.current) { setData(d); setError(""); }
    } catch (e: any) { if (my === tick.current) setError(e.message); }
    finally { if (my === tick.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { run(); }, [run]);
  return { data, loading, error, reload: run, setData };
}
