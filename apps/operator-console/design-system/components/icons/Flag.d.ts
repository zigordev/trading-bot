import * as React from 'react';

export type FlagCode = 'gb' | 'es';

export interface FlagProps extends React.SVGAttributes<SVGSVGElement> {
  /** ISO 3166-1 alpha-2 country code. */
  code: FlagCode;
  /** Width in px; height follows the 4:3 flag ratio. @default 20 */
  size?: number;
}

export declare function Flag(props: FlagProps): JSX.Element | null;
export declare const flagCodes: FlagCode[];
