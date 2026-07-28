import * as React from 'react';

export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Render as a link (keeps the mode deep-linkable) instead of a button. */
  href?: string;
  /** `danger` repaints the whole control while this option is active. */
  tone?: 'neutral' | 'danger';
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  /** Only used for non-`href` options. */
  onChange?: (value: string) => void;
  /** Link component for `href` options, e.g. Next.js `Link`. @default 'a' */
  linkComponent?: React.ElementType;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

export declare function SegmentedControl(props: SegmentedControlProps): JSX.Element;
