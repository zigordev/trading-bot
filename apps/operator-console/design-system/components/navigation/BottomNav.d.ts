import * as React from 'react';

export interface BottomNavItem {
  href: string;
  label: React.ReactNode;
  /** Required, unlike Sidebar — bottom nav is always icon + label. */
  icon: React.ReactNode;
}

export interface BottomNavProps {
  /** 3-5 pre-truncated primary destinations. */
  items: BottomNavItem[];
  activeHref: string;
  className?: string;
  style?: React.CSSProperties;
}

export declare function BottomNav(props: BottomNavProps): JSX.Element;
