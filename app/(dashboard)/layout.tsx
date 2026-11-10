import Header from "layouts/header/Header";
import Sidebar from "layouts/Sidebar";
import { AppProvider } from "components/erp/AppProvider";

const DashboardLayout = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>
    <div>
      <Sidebar hideLogo={false} containerId="miniSidebar" />
      <div id="content" className="position-relative h-100">
        <Header />
        <div className="custom-container">{children}</div>
        <div className="custom-container text-secondary small">Arshith Group Finance ERP · Figures are computed from posted ledger entries · INR</div>
      </div>
    </div>
  </AppProvider>
);
export default DashboardLayout;
