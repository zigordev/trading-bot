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
  | 'clock'
  | 'calendar'
  | 'star'
  | 'external-link'
  | 'triangle-alert'
  | 'circle-x'
  | 'circle-check'
  | 'info'
  | 'square'
  | 'dollar-sign'
  | 'chart-column'
  | 'wand-sparkles'
  | 'plus'
  | 'search'
  | 'copy'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'trash-2'
  | 'pencil'
  | 'filter'
  | 'loader-circle'
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
