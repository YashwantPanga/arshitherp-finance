"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Form, Spinner } from "react-bootstrap";
import AuthShell from "components/erp/AuthShell";
import { api } from "lib/client";

function Inner() {
  const token = useSearchParams().get("token") || "";
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false); const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (pw !== pw2) { setErr("Passwords do not match"); return; }
    setBusy(true); setErr("");
    try { await api("/auth/reset", { body: { token, password: pw } }); setOk(true); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return ok ? (
    <div><div className="alert alert-success small">Password updated. All other sessions were signed out.</div><Link href="/sign-in" className="btn btn-primary w-100">Sign in</Link></div>
  ) : (
    <Form onSubmit={submit}>
      <Form.Group className="mb-3"><Form.Label>New password</Form.Label><Form.Control type="password" required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /><Form.Text className="text-secondary">At least 10 characters with upper case, lower case and a number.</Form.Text></Form.Group>
      <Form.Group className="mb-3"><Form.Label>Confirm password</Form.Label><Form.Control type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Form.Group>
      {err && <div className="alert alert-danger py-2 small">{err}</div>}
      <Button type="submit" className="w-100" disabled={busy || !token}>{busy && <Spinner size="sm" className="me-2" />}Set new password</Button>
    </Form>
  );
}
export default function Reset() {
  return <AuthShell title="Choose a new password"><Suspense><Inner /></Suspense></AuthShell>;
}
