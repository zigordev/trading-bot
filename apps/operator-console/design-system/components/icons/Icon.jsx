import React from 'react';
import { iconPaths } from './paths.js';

export function Icon({ name, size = 18, strokeWidth = 1.75, className = '', style, ...props }) {
  const nodes = iconPaths[name];
  if (!nodes) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      {...props}
    >
      {nodes.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

export const iconNames = Object.keys(iconPaths);
