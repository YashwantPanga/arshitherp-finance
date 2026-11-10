import { Suspense } from "react";
import TxnPage from "components/erp/TxnPage";

export default function IncomePage() {
  return <Suspense><TxnPage kind="income" /></Suspense>;
}
