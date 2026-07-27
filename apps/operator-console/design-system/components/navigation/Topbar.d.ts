import * as React from 'react';

export interface TopbarProps {
  /** Only shown below --ds-breakpoint-nav by default (Sidebar covers desktop). */
  brand?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  /** Page-level actions (change per route). */
  actions?: React.ReactNode;
  /** Chrome-level controls that don't change per route (theme, language, user menu). */
  utilities?: React.ReactNode;
  /** Horizontally-scrollable contextual tab row, or a mobile-only duplicate of primary nav. */
  tabs?: React.ReactNode;
  /** Second full-width row below `tabs` (e.g. a record's name + status + actions). */
  subBar?: React.ReactNode;
  /** Set false for apps with no Sidebar, so brand always shows. Default true. */
  hideBrandOnDesktop?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export declare function Topbar(props: TopbarProps): JSX.Element;
