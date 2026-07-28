import * as React from 'react';

export interface AppShellNavItem {
  href: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  children?: AppShellNavItem[];
}

export interface AppShellBottomNavItem {
  href: string;
  label: React.ReactNode;
  icon: React.ReactNode;
}

export interface AppShellTopbarSlots {
  title?: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  utilities?: React.ReactNode;
  tabs?: React.ReactNode;
  /** Mode switch for the current screen — typically a `SegmentedControl`. */
  mode?: React.ReactNode;
  subBar?: React.ReactNode;
}

export interface AppShellProps {
  brand: React.ReactNode;
  /** Scope selector — rendered at the top of Sidebar on desktop, and into
   * Topbar below the nav breakpoint (where Sidebar is hidden). Typically a
   * `ScopeSwitcher`. */
  scope?: React.ReactNode;
  sidebarItems: AppShellNavItem[];
  /** Derived automatically (first 5 sidebarItems with an icon) if omitted. */
  bottomNavItems?: AppShellBottomNavItem[];
  activeHref: string;
  sidebarFooter?: React.ReactNode;
  /** Forwarded straight to Topbar (everything except brand/hideBrandOnDesktop, which AppShell supplies). */
  topbar?: AppShellTopbarSlots;
  /** Default true. All three products use a sidebar after the nav unification. */
  hasSidebar?: boolean;
  /** Forwarded to Sidebar/BottomNav. Default 'a'. Pass your router's Link
   * (next/link, react-router's Link, etc.) for client-side navigation instead
   * of a full page reload — the framework-agnostic default is a plain anchor. */
  linkComponent?: React.ElementType;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export declare function AppShell(props: AppShellProps): JSX.Element;
