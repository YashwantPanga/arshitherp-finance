import { Suspense } from "react";
import DocsPage from "components/erp/DocsPage";

export default function PayablesPage() {
  return <Suspense><DocsPage kind="bill" /></Suspense>;
}
