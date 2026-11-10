"use client";
/***************************
Component : ActionMenu
****************************

Available Parameters

toggleButton  : Required, it will be an object like, button, icon, span etc... don't use hyperlink for this one.
menuItems     : Optional, it will be menu items, if you omit it will show blank menu, if you have specified list of child items (children parameters ) you don't need to pass anything to menuItems.
className     : Optional, class list for CustomToggle object e.g. circle, rounded, rounded-circle, bg-info etc...
align         : Optional, Menu alignment it can be 'start' or 'end' default = 'end'
drop          : Optional, Open direction it can be 'up', 'up-centered', 'start', 'end', 'down', 'down-centered', default = 'start'.
itemClass     : Optional, class list for Dropdown.Item 
children	    : Optional, it will be list of items of Dropdown.Item, if you have specified list of child item, you don't need to specify menuItems array.

Note: If you have specified both menuItems and children parameters, menuItems will be used.
 
*/

// import node module libraries
import Link from "next/link";
import React, { Fragment } from "react";
import { Dropdown } from "react-bootstrap";

interface CustomToggleProps {
  children: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

interface ActionMenuProps {
  toggleButton: React.ReactNode;
  className?: string;
  align?: "start" | "end";
  drop?: "up" | "up-centered" | "start" | "end" | "down" | "down-centered";
  menuItems?: Array<{ link: string; menuItem: string; icon?: React.ReactNode }>;
  itemClass?: string;
  children?: React.ReactNode;
  size?: "sm" | "lg" | undefined;
  variant?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

const ActionMenu: React.FC<ActionMenuProps> = ({
  toggleButton,
  className,
  align = "end",
  drop = "start",
  menuItems = [],
  itemClass,
  children,
  size,
  variant,
  onClick,
}) => {
  const CustomToggle = React.forwardRef<HTMLAnchorElement, CustomToggleProps>(
    ({ children, onClick }, ref) => (
      <Link
        ref={ref}
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onClick(e);
        }}
        className={className}
      >
        {children}
      </Link>
    )
  );

  CustomToggle.displayName = "CustomToggle";

  return (
    <Dropdown drop={drop}>
      <Dropdown.Toggle variant={variant} size={size} as={CustomToggle}>
        {toggleButton}
      </Dropdown.Toggle>
      <Dropdown.Menu align={align}>
        {menuItems.length > 0 ? (
          menuItems.map((item, index) => (
            <Dropdown.Item
              key={index}
              as={Link}
              href={item.link}
              className={itemClass}
              onClick={onClick}
            >
              {item.icon ? item.icon : ""}
              {item.menuItem}
            </Dropdown.Item>
          ))
        ) : (
          <Fragment>{children}</Fragment>
        )}
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default ActionMenu;
