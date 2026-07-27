import * as React from 'react';

export interface LogoProps {
  /** Arbitrary icon/mark node. Takes precedence over `initials`. */
  mark?: React.ReactNode;
  /** Letter/initials text, used when `mark` is absent. */
  initials?: string;
  wordmark?: string;
  /** Only rendered at size="lg". */
  tagline?: string;
  size?: 'sm' | 'md' | 'lg';
  shape?: 'circle' | 'square';
  href?: string;
  className?: string;
  style?: React.CSSProperties;
}

export declare function Logo(props: LogoProps): JSX.Element;
