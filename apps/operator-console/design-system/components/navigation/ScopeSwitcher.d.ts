import * as React from 'react';

export interface ScopeItem {
  id: string;
  label: React.ReactNode;
  active?: boolean;
  onSelect?: (id: string) => void;
}

export interface ScopeSwitcherProps {
  /** Small uppercase caption above the current value, e.g. "Team", "Pool". */
  label?: React.ReactNode;
  /** Current scope's display name. */
  value?: React.ReactNode;
  /** Shown when nothing is selected yet. @default '—' */
  placeholder?: React.ReactNode;
  items?: ScopeItem[];
  /** Actions below a divider, e.g. "Manage teams…". Receives `{ close }` when a function. */
  footer?: React.ReactNode | ((args: { close: () => void }) => React.ReactNode);
  className?: string;
  style?: React.CSSProperties;
}

export declare function ScopeSwitcher(props: ScopeSwitcherProps): JSX.Element;
