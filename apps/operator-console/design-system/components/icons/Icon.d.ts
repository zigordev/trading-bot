import * as React from 'react';

export type IconName =
  | 'home'
  | 'trophy'
  | 'list-plus'
  | 'trending-up'
  | 'users'
  | 'user'
  | 'shield'
  | 'edit'
  | 'log-out'
  | 'sun'
  | 'moon'
  | 'globe'
  | 'layout-dashboard'
  | 'history'
  | 'chart-line'
  | 'settings'
  | 'x'
  | 'menu'
  | 'chevron-down'
  | 'chevron-right'
  | 'check'
  | 'circle-alert';

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Which glyph to render. */
  name: IconName;
  /** Square pixel size (width and height). @default 18 */
  size?: number;
  /** @default 1.75 */
  strokeWidth?: number;
}

export declare function Icon(props: IconProps): JSX.Element | null;
export declare const iconNames: IconName[];
