//import node modules libraries
import { useContext, ReactNode } from "react";
import { AccordionContext, useAccordionButton, Nav } from "react-bootstrap";
import Link from "next/link";

interface CustomToggleProps {
  children: ReactNode;
  eventKey: string;
  className?: string;
  href?: string;
  dataBsTarget?: string;
  ariaControls?: string;
  icon?: ReactNode;
  callback?: (eventKey: string) => void;
}

export default function CustomToggle({
  children,
  eventKey,
  icon,
  callback,
}: CustomToggleProps) {
  const { activeEventKey } = useContext(AccordionContext);
  const decoratedOnClick = useAccordionButton(
    eventKey,
    () => callback && callback(eventKey)
  );

  const isCurrentEventKey = activeEventKey === eventKey;
  return (
    <Nav.Item as="li" className="dropdown">
      <Nav.Link
        href="#"
        onClick={decoratedOnClick}
        data-bs-toggle="dropdown"
        aria-expanded={isCurrentEventKey ? true : false}
        className="dropdown-toggle"
      >
        <span className="nav-icon">{icon}</span>
        <span className="text">{children}</span>
      </Nav.Link>
    </Nav.Item>
  );
}

export function CustomToggleLevel2({
  children,
  eventKey,
  className = "nav-link",
  href = "#",
  dataBsTarget = "",
  ariaControls = "",
}: CustomToggleProps) {
  const { activeEventKey } = useContext(AccordionContext);
  const decoratedOnClick = useAccordionButton(eventKey);
  const isCurrentEventKey = activeEventKey === eventKey;

  return (
    <Link
      href={href}
      className={className}
      onClick={decoratedOnClick}
      data-bs-toggle="collapse"
      data-bs-target={dataBsTarget}
      aria-expanded={isCurrentEventKey}
      aria-controls={ariaControls}
    >
      <span>{children}</span>
    </Link>
  );
}
