import * as React from 'react';

export interface SidebarNavItem {
  href: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** One level of sub-destinations, e.g. Execution → Paper/Live. */
  children?: SidebarNavItem[];
}

export interface SidebarProps {
  brand: React.ReactNode;
  items: SidebarNavItem[];
  activeHref: string;
  /** Pinned to the bottom of the rail — e.g. a user menu or status block. */
  footer?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export declare function Sidebar(props: SidebarProps): JSX.Element;
