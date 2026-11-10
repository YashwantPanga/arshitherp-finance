"use client";
import React, { Fragment } from "react";
import Link from "next/link";
import { useMediaQuery } from "react-responsive";
import { IconArrowBarLeft, IconArrowBarRight, IconMenu2 } from "@tabler/icons-react";
import { Container, Form, ListGroup, Navbar } from "react-bootstrap";
import UserMenu from "./UserMenu";
import AlertsBell from "./AlertsBell";
import Flex from "components/common/Flex";
import OffcanvasSidebar from "layouts/OffcanvasSidebar";
import useMenu from "hooks/useMenu";
import { useApp } from "components/erp/AppProvider";

const Header = () => {
  const { toggleMenuHandler, handleCollapsed } = useMenu();
  const { meta, company, setCompany, toggleDark, dark } = useApp();
  const isTablet = useMediaQuery({ maxWidth: 990 });
  const mine = meta?.companies.filter((c) => meta.user.companyIds.includes(c.id)) || [];
  return (
    <Fragment>
      <Navbar expand="lg" className="navbar-glass px-0 px-lg-4">
        <Container fluid className="px-lg-0">
          <Flex alignItems="center" className="gap-3">
            {isTablet && <div className="d-block d-lg-none" style={{ cursor: "pointer" }} onClick={() => toggleMenuHandler(true)}><IconMenu2 size={24} /></div>}
            {isTablet || (
              <Link href="#" className="sidebar-toggle d-flex p-3" onClick={(e) => e.preventDefault()}>
                <span className="collapse-mini" onClick={() => handleCollapsed("expanded")}><IconArrowBarLeft size={20} strokeWidth={1.5} className="text-secondary" /></span>
                <span className="collapse-expanded" onClick={() => handleCollapsed("collapsed")}><IconArrowBarRight size={20} strokeWidth={1.5} className="text-secondary" /></span>
              </Link>
            )}
            <div className="d-flex align-items-center gap-2">
              <i className="ti ti-building-community text-primary fs-4 d-none d-sm-inline" />
              <Form.Select size="sm" aria-label="Company switcher" value={company} onChange={(e) => setCompany(e.target.value)} style={{ minWidth: 170, fontWeight: 600 }}>
                {mine.length > 1 && <option value="all">All Companies</option>}
                {mine.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Form.Select>
            </div>
          </Flex>
          <ListGroup bsPrefix="list-unstyled" as="ul" className="d-flex align-items-center mb-0 gap-2">
            <ListGroup.Item as="li">
              <button className="btn btn-ghost btn-icon rounded-circle" onClick={toggleDark} aria-label="Toggle dark mode"><i className={`ti ${dark ? "ti-sun" : "ti-moon"} fs-5`} /></button>
            </ListGroup.Item>
            <ListGroup.Item as="li"><AlertsBell /></ListGroup.Item>
            <ListGroup.Item as="li"><UserMenu /></ListGroup.Item>
          </ListGroup>
        </Container>
      </Navbar>
      {isTablet && <OffcanvasSidebar />}
    </Fragment>
  );
};
export default Header;
