import React from 'react';
import { injectOnce } from '../_shared/injectStyle.js';

injectOnce('ds-sidebar', `
.ds-sidebar{display:flex;}
@media (max-width: 1024px) { .ds-sidebar { display: none; } }
.ds-sidebar-link:hover:not(.ds-sidebar-link-active){background:var(--ds-color-surface-2);color:var(--ds-color-fg);}
.ds-sidebar-child:hover:not(.ds-sidebar-child-active){background:var(--ds-color-surface-2);color:var(--ds-color-fg);}
`);

function isActive(href, activeHref) {
  return href === activeHref || (href !== '/' && activeHref.startsWith(`${href}/`));
}

function SidebarItem({ item, activeHref, linkComponent }) {
  const active = isActive(item.href, activeHref);
  const hasChildren = item.children && item.children.length > 0;
  const showChildren = hasChildren && active;
  const Link = linkComponent;

  return (
    <div>
      <Link
        href={item.href}
        className={`ds-sidebar-link ${active ? 'ds-sidebar-link-active' : ''}`.trim()}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 'var(--ds-radius-md)',
          fontSize: 'var(--ds-text-sm)', fontWeight: 'var(--ds-weight-semibold)', textDecoration: 'none',
          color: active ? 'var(--ds-color-accent)' : 'var(--ds-color-fg-muted)',
          background: active ? 'var(--ds-color-accent-soft)' : 'transparent',
        }}
      >
        {item.icon ? <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 18 }}>{item.icon}</span> : null}
        <span>{item.label}</span>
      </Link>
      {showChildren ? (
        <div style={{ display: 'grid', gap: 2, marginTop: 4, marginLeft: 28, paddingLeft: 8, borderLeft: '1px solid var(--ds-color-border)' }}>
          {item.children.map((child) => {
            const childActive = child.href === activeHref;
            return (
              <Link
                key={child.href}
                href={child.href}
                className={`ds-sidebar-child ${childActive ? 'ds-sidebar-child-active' : ''}`.trim()}
                style={{
                  display: 'block', padding: '7px 10px', borderRadius: 'var(--ds-radius-md)', textDecoration: 'none',
                  fontSize: 'var(--ds-text-xs)', fontWeight: childActive ? 'var(--ds-weight-semibold)' : 'var(--ds-weight-medium)',
                  color: childActive ? 'var(--ds-color-accent)' : 'var(--ds-color-fg-muted)',
                }}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({ brand, scope, items, activeHref, footer, linkComponent = 'a', className = '', style }) {
  return (
    <aside
      className={`ds-sidebar ${className}`.trim()}
      style={{
        width: 240, flexShrink: 0, flexDirection: 'column',
        borderRight: '1px solid var(--ds-color-border)', background: 'var(--ds-color-surface)',
        fontFamily: 'var(--ds-font-sans)', ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 56, padding: '0 20px', borderBottom: '1px solid var(--ds-color-border)' }}>
        {brand}
      </div>
      {scope ? (
        <div style={{ padding: '12px 12px 0' }}>
          {scope}
        </div>
      ) : null}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'grid', gap: 4, alignContent: 'start' }}>
        {items.map((item) => (
          <SidebarItem key={item.href} item={item} activeHref={activeHref} linkComponent={linkComponent} />
        ))}
      </nav>
      {footer ? (
        <div style={{ borderTop: '1px solid var(--ds-color-border)', padding: 'var(--ds-space-4)' }}>
          {footer}
        </div>
      ) : null}
    </aside>
  );
}
