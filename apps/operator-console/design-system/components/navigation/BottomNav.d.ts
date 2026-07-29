import * as React from 'react';

export interface BottomNavItem {
  href: string;
  /** Match this path exactly — see Sidebar. */
  exact?: boolean;
  label: React.ReactNode;
  /** Required, unlike Sidebar — bottom nav is always icon + label. */
  icon: React.ReactNode;
}

export interface BottomNavProps {
  /** 3-5 pre-truncated primary destinations. */
  items: BottomNavItem[];
  activeHref: string;
  /** Component/tag used for nav links. Default 'a'. Pass your router's Link
   * for client-side navigation instead of a full page reload. */
  linkComponent?: React.ElementType;
  className?: string;
  style?: React.CSSProperties;
}

export declare function BottomNav(props: BottomNavProps): JSX.Element;
