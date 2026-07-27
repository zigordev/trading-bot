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
  /** Component/tag used for nav links. Default 'a'. Pass your router's Link
   * (next/link, react-router's Link, etc.) for client-side navigation instead
   * of a full page reload. Must accept an `href` prop. */
  linkComponent?: React.ElementType;
  className?: string;
  style?: React.CSSProperties;
}

export declare function Sidebar(props: SidebarProps): JSX.Element;
