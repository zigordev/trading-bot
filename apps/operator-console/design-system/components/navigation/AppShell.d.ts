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
  subBar?: React.ReactNode;
}

export interface AppShellProps {
  brand: React.ReactNode;
  sidebarItems: AppShellNavItem[];
  /** Derived automatically (first 5 sidebarItems with an icon) if omitted. */
  bottomNavItems?: AppShellBottomNavItem[];
  activeHref: string;
  sidebarFooter?: React.ReactNode;
  /** Forwarded straight to Topbar (everything except brand/hideBrandOnDesktop, which AppShell supplies). */
  topbar?: AppShellTopbarSlots;
  /** Default true. All three products use a sidebar after the nav unification. */
  hasSidebar?: boolean;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export declare function AppShell(props: AppShellProps): JSX.Element;
