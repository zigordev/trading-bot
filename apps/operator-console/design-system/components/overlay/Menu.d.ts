import * as React from 'react';

export interface MenuProps {
  /** Trigger element — any node, typically a Button. Click toggles the panel. */
  trigger: React.ReactNode;
  /** Panel content, or a render function receiving `{ close }` to dismiss on item click. */
  children: React.ReactNode | ((args: { close: () => void }) => React.ReactNode);
  /** Panel horizontal alignment relative to the trigger. Default 'end' (right-aligned). */
  align?: 'start' | 'end';
  className?: string;
  style?: React.CSSProperties;
}

export declare function Menu(props: MenuProps): JSX.Element;

export interface MenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export declare function MenuItem(props: MenuItemProps): JSX.Element;
