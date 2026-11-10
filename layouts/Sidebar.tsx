"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Nav } from "react-bootstrap";
import { NAV } from "routes/DashboardRoute";
import { useApp } from "components/erp/AppProvider";

interface SidebarProps { hideLogo: boolean; containerId?: string }

export const Brand = () => (
  <Link href="/" className="d-flex align-items-center gap-2">
    <span className="d-inline-flex align-items-center justify-content-center rounded-3 text-white" style={{ width: 34, height: 34, background: "linear-gradient(135deg,#00a76f,#007867)" }}>
      <i className="ti ti-chart-infographic fs-4" />
    </span>
    <span className="fw-bold fs-4 site-logo-text">Arshith<span className="text-primary">ERP</span></span>
  </Link>
);

const Sidebar: React.FC<SidebarProps> = ({ hideLogo = false, containerId }) => {
  const path = usePathname();
  const { can, meta, companyName } = useApp();
  const items = NAV.filter((n) => !n.perm || can(n.perm));
  const active = (l?: string) => (l === "/" ? path === "/" : !!l && path.startsWith(l));
  return (
    <div id={containerId}>
      <div>
        {hideLogo || <div className="brand-logo d-none d-md-flex"><Brand /></div>}
        <ul className="navbar-nav flex-column">
          {items.map((n, i) =>
            n.group ? (
              <li key={i} className="nav-item">
                <div className="nav-heading">{n.title}</div>
                <hr className="mx-5 nav-line mb-1" />
              </li>
            ) : (
              <Nav.Item as="li" key={i}>
                <Link href={n.link!} className={`nav-link ${active(n.link) ? "active" : ""}`}>
                  <span className="nav-icon"><i className={`ti ${n.icon} fs-5`} /></span>
                  <span className="text">{n.title}</span>
                </Link>
              </Nav.Item>
            )
          )}
          <li className="nav-item">
            <div className="text-center py-5 upgrade-ui">
              <div className="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary-subtle text-primary-emphasis fw-bold mb-3" style={{ width: 44, height: 44 }}>
                {meta?.user.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <h5 className="mb-1 fs-6">{meta?.user.name}</h5>
              <span className="text-secondary small d-block">{meta?.user.role.replace("_", " ")}</span>
              <span className="text-secondary small">{companyName}</span>
            </div>
          </li>
        </ul>
      </div>
    </div>
  );
};
export default Sidebar;
