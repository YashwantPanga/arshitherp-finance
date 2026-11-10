"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Form, Spinner } from "react-bootstrap";
import AuthShell from "components/erp/AuthShell";
import { api } from "lib/client";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await api("/auth/login", { body: { email, password } }); router.replace("/"); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to the Arshith Group finance workspace">
      <Form onSubmit={submit}>
        <Form.Group className="mb-3">
          <Form.Label>Email</Form.Label>
          <Form.Control type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label>Password</Form.Label>
          <div className="position-relative">
            <Form.Control type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="btn btn-sm position-absolute top-50 end-0 translate-middle-y me-1 text-secondary" onClick={() => setShow(!show)} aria-label="Show password"><i className={`ti ${show ? "ti-eye-off" : "ti-eye"}`} /></button>
          </div>
        </Form.Group>
        {err && <div className="alert alert-danger py-2 small"><i className="ti ti-alert-circle me-1" />{err}</div>}
        <div className="d-flex justify-content-end mb-4"><Link href="/forgot-password" className="small text-primary">Forgot password?</Link></div>
        <Button type="submit" className="w-100" disabled={busy}>{busy && <Spinner size="sm" className="me-2" />}Sign in</Button>
      </Form>
    </AuthShell>
  );
}
