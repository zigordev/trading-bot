import React from 'react';
import { flagPaths } from './flagPaths.js';

export function Flag({ code, size = 20, className = '', style, ...props }) {
  const nodes = flagPaths[code];
  if (!nodes) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size * 0.75}
      viewBox="0 0 640 480"
      className={className}
      style={{
        display: 'block',
        flexShrink: 0,
        borderRadius: 2,
        outline: '1px solid var(--ds-color-border)',
        outlineOffset: -1,
        ...style,
      }}
      aria-hidden="true"
      {...props}
    >
      {nodes.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

export const flagCodes = Object.keys(flagPaths);
