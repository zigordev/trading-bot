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
  /** Component/tag used when `href` is set. Default 'a'. Pass your router's
   * Link for client-side navigation instead of a full page reload. */
  linkComponent?: React.ElementType;
  className?: string;
  style?: React.CSSProperties;
}

export declare function Logo(props: LogoProps): JSX.Element;
