import * as React from 'react';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual treatment. `danger` for destructive actions. */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  /** `icon` is a square button — pair with a single glyph child. */
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export declare function Button(props: ButtonProps): JSX.Element;
