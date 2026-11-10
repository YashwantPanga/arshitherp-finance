import {
  AlignContentType,
  AlignItemsType,
  BreakpointType,
  DirectionType,
  HTMLElementType,
  JustifyContentType,
} from "./Index";
import { JSX } from "react";

export interface IFlex extends HTMLElementType {
  justifyContent?: JustifyContentType;
  alignItems?: AlignItemsType;
  alignContent?: AlignContentType;
  inline?: boolean;
  wrap?: boolean;
  className?: string;
  tag?: keyof JSX.IntrinsicElements;
  children: React.ReactNode;
  breakpoint?: BreakpointType;
  direction?: DirectionType;
}
