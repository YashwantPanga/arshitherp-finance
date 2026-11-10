"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Form, Spinner } from "react-bootstrap";
import AuthShell from "components/erp/AuthShell";
import { api } from "lib/client";

export default function Forgot() {
  const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string; devToken?: string } | null>(null); const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { setDone(await api("/auth/forgot", { body: { email } })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Reset your password" subtitle="We will issue a single-use link valid for 30 minutes">
      {done ? (
        <div>
          <div className="alert alert-success small">{done.message}</div>
          <p className="small text-secondary">Email delivery needs SMTP credentials, which are not configured in this environment. Until then the link is written to the server log, and in development it is shown below.</p>
          {done.devToken && <Link className="btn btn-outline-primary w-100 mb-3" href={`/reset-password?token=${done.devToken}`}>Open reset link (development only)</Link>}
          <Link href="/sign-in" className="small text-primary">Back to sign in</Link>
        </div>
      ) : (
        <Form onSubmit={submit}>
          <Form.Group className="mb-3"><Form.Label>Work email</Form.Label><Form.Control type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Form.Group>
          {err && <div className="alert alert-danger py-2 small">{err}</div>}
          <Button type="submit" className="w-100 mb-3" disabled={busy}>{busy && <Spinner size="sm" className="me-2" />}Send reset link</Button>
          <div className="text-center"><Link href="/sign-in" className="small text-primary">Back to sign in</Link></div>
        </Form>
      )}
    </AuthShell>
  );
}
