//import node modules libraries
import { HTMLAttributes } from "react";

export type RouteType = {
  to: string;
  active: boolean;
  name: string;
  icon?: string | string[];
  badge?: { type?: string; text?: string };
};
export type ChildrenType = {
  name: string;
  icon?: string | string[];
  to?: string;
  active: boolean;
  exact?: boolean;
  badge?: { type?: string; text?: string };
  children?: ChildrenType[];
};
export type PageRoutesType = {
  label: string;
  labelDisable?: boolean;
  children: ChildrenType[];
};

export type HTMLElementType = HTMLAttributes<HTMLOrSVGElement>;
export type BreakpointType = "sm" | "md" | "lg" | "xl" | "xxl";
export type BpType = {
  [key in "xs" | "sm" | "md" | "lg" | "xl" | "xxl"]: number;
};
export type DirectionType = "row" | "column" | undefined;
export type AlignContentType =
  | "start"
  | "end"
  | "center"
  | "around"
  | "stretch"
  | "sm-start"
  | "sm-end"
  | "sm-center"
  | "sm-around"
  | "sm-stretch"
  | "md-start"
  | "md-end"
  | "md-center"
  | "md-around"
  | "md-stretch"
  | "lg-start"
  | "lg-end"
  | "lg-center"
  | "lg-around"
  | "lg-stretch"
  | "xl-start"
  | "xl-end"
  | "xl-center"
  | "xl-around"
  | "xl-stretch"
  | "xxl-start"
  | "xxl-end"
  | "xxl-center"
  | "xxl-around"
  | "xxl-stretch";
export type AlignItemsType =
  | "start"
  | "end"
  | "center"
  | "baseline"
  | "stretch"
  | "sm-start"
  | "sm-end"
  | "sm-center"
  | "sm-baseline"
  | "sm-stretch"
  | "md-start"
  | "md-end"
  | "md-center"
  | "md-baseline"
  | "md-stretch"
  | "lg-start"
  | "lg-end"
  | "lg-center"
  | "lg-baseline"
  | "lg-stretch"
  | "xl-start"
  | "xl-end"
  | "xl-center"
  | "xl-baseline"
  | "xl-stretch"
  | "xxl-start"
  | "xxl-end"
  | "xxl-center"
  | "xxl-baseline"
  | "xxl-stretch";
export type JustifyContentType =
  | "start"
  | "end"
  | "center"
  | "between"
  | "around"
  | "evenly"
  | "sm-start"
  | "sm-end"
  | "sm-center"
  | "sm-between"
  | "sm-around"
  | "sm-evenly"
  | "md-start"
  | "md-end"
  | "md-center"
  | "md-between"
  | "md-around"
  | "md-evenly"
  | "lg-start"
  | "lg-end"
  | "lg-center"
  | "lg-between"
  | "lg-around"
  | "lg-evenly"
  | "xl-start"
  | "xl-end"
  | "xl-center"
  | "xl-between"
  | "xl-around"
  | "xl-evenly"
  | "xxl-start"
  | "xxl-end"
  | "xxl-center"
  | "xxl-between"
  | "xxl-around"
  | "xxl-evenly";
