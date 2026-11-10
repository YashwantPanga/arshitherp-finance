"use client";
import React from "react";
import { Dropdown } from "react-bootstrap";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "lib/client";
import { useApp } from "components/erp/AppProvider";

const Toggle = React.forwardRef<HTMLAnchorElement, { children?: React.ReactNode; onClick?: () => void }>(({ children, onClick }, ref) => (
  <Link ref={ref} href="#" onClick={(e) => { e.preventDefault(); onClick?.(); }}>{children}</Link>
));
Toggle.displayName = "Toggle";

const UserMenu = () => {
  const { meta, toggleDark, dark } = useApp();
  const router = useRouter();
  const initials = meta?.user.name.split(" ").map((w) => w[0]).slice(0, 2).join("") || "U";
  const out = async () => { await api("/auth/logout", { method: "POST", body: {} }).catch(() => {}); router.replace("/sign-in"); };
  return (
    <Dropdown>
      <Dropdown.Toggle as={Toggle}>
        <span className="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary text-white fw-bold" style={{ width: 36, height: 36, fontSize: 13 }}>{initials}</span>
      </Dropdown.Toggle>
      <Dropdown.Menu align="end" className="p-0 dropdown-menu-md">
        <div className="d-flex gap-3 align-items-center border-dashed border-bottom px-4 py-4">
          <span className="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary-subtle text-primary-emphasis fw-bold" style={{ width: 44, height: 44 }}>{initials}</span>
          <div>
            <h4 className="mb-0 fs-5">{meta?.user.name}</h4>
            <p className="mb-0 text-secondary small">{meta?.user.email}</p>
            <span className="badge bg-primary-subtle text-primary-emphasis mt-1">{meta?.user.role.replace("_", " ")}</span>
          </div>
        </div>
        <div className="p-3 d-flex flex-column gap-1">
          <Dropdown.Item as={Link} href="/settings" className="d-flex align-items-center gap-2"><i className="ti ti-settings fs-5" />Settings &amp; security</Dropdown.Item>
          <Dropdown.Item onClick={toggleDark} className="d-flex align-items-center gap-2"><i className={`ti ${dark ? "ti-sun" : "ti-moon"} fs-5`} />{dark ? "Light mode" : "Dark mode"}</Dropdown.Item>
        </div>
        <div className="border-dashed border-top mb-4 pt-4 px-6">
          <a href="#" onClick={(e) => { e.preventDefault(); out(); }} className="text-secondary d-flex align-items-center gap-2"><i className="ti ti-logout fs-5" /><span>Sign out</span></a>
        </div>
      </Dropdown.Menu>
    </Dropdown>
  );
};
export default UserMenu;
