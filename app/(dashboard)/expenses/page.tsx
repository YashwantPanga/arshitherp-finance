import { Suspense } from "react";
import TxnPage from "components/erp/TxnPage";

export default function ExpensesPage() {
  return <Suspense><TxnPage kind="expense" /></Suspense>;
}
