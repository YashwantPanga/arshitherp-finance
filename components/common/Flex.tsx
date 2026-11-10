//import node modules libraries
import { FC } from "react";
import classNames from "classnames";
import { IFlex } from "types/FlexType";

const Flex: FC<IFlex> = function Flex({
  justifyContent,
  alignItems,
  alignContent,
  inline,
  wrap,
  className,
  tag: Tag = "div",
  children,
  breakpoint,
  direction,
  ...rest
}) {
  return (
    <Tag
      className={classNames(
        {
          [`d-${breakpoint ? `${breakpoint}-` : ""}flex`]: !inline,
          [`d-${breakpoint ? `${breakpoint}-` : ""}inline-flex`]: inline,
          [`flex-${direction}`]: direction,
          [`justify-content-${justifyContent}`]: justifyContent,
          [`align-items-${alignItems}`]: alignItems,
          [`align-content-${alignContent}`]: alignContent,
          [`flex-${wrap}`]: wrap,
        },
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
};

export default Flex;
