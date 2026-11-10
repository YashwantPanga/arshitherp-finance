"use client";
import Offcanvas from "react-bootstrap/Offcanvas";
import OffcanvasBody from "react-bootstrap/OffcanvasBody";
import OffcanvasHeader from "react-bootstrap/OffcanvasHeader";
import Sidebar, { Brand } from "./Sidebar";
import useMenu from "hooks/useMenu";

const OffcanvasSidebar = () => {
  const { showMenu, toggleMenuHandler } = useMenu();
  return (
    <Offcanvas placement="start" show={showMenu} onHide={() => toggleMenuHandler(false)} backdrop bsPrefix="offcanvasNav offcanvas offcanvas-start ">
      <OffcanvasHeader closeButton><Brand /></OffcanvasHeader>
      <OffcanvasBody className="p-0"><Sidebar hideLogo /></OffcanvasBody>
    </Offcanvas>
  );
};
export default OffcanvasSidebar;
