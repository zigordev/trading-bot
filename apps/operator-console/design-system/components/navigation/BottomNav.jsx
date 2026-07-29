import React from 'react';
import { injectOnce } from '../_shared/injectStyle.js';

injectOnce('ds-bottom-nav', `
.ds-bottom-nav{display:none;}
@media (max-width: 1024px) {
  .ds-bottom-nav{position:fixed;z-index:60;left:0;right:0;bottom:0;display:grid;height:var(--ds-space-16);
    border-top:1px solid var(--ds-color-border);background:var(--ds-color-surface-translucent);
    backdrop-filter:blur(var(--ds-color-surface-blur));-webkit-backdrop-filter:blur(var(--ds-color-surface-blur));}
}
.ds-bottom-nav-link{display:grid;place-content:center;justify-items:center;gap:2px;text-decoration:none;
  color:var(--ds-color-fg-muted);font-family:var(--ds-font-sans);font-size:var(--ds-text-xs);font-weight:var(--ds-weight-medium);}
.ds-bottom-nav-link-active{color:var(--ds-color-accent);font-weight:var(--ds-weight-semibold);}
`);

export function BottomNav({ items, activeHref, linkComponent = 'a', className = '', style }) {
  const Link = linkComponent;
  return (
    <nav
      className={`ds-bottom-nav ${className}`.trim()}
      style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)`, ...style }}
    >
      {items.map((item) => {
        // Same rule as Sidebar: prefix-match so a section stays lit inside
        // itself, unless `exact` says this is a list route whose detail pages
        // live underneath it.
        const active = item.href === activeHref
          || (!item.exact && item.href !== '/' && activeHref.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`ds-bottom-nav-link ${active ? 'ds-bottom-nav-link-active' : ''}`.trim()}
          >
            <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
