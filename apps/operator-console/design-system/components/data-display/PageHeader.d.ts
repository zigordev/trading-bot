import * as React from 'react';

export interface PageHeaderProps {
  /** Small uppercase accent line above the title. */
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Screen-level actions, right-aligned. */
  actions?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export declare function PageHeader(props: PageHeaderProps): JSX.Element;
