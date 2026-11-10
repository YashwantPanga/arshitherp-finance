import { Suspense } from "react";
import DocsPage from "components/erp/DocsPage";

export default function ReceivablesPage() {
  return <Suspense><DocsPage kind="invoice" /></Suspense>;
}
