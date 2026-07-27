import React from 'react';
import Link from 'next/link';
import { injectOnce } from '../_shared/injectStyle.js';

/* Local deviation from the shared v0.1.2 source: swapped the plain <a href>
   tags for next/link's <Link>. Confirmed in-browser during migration
   verification that with plain anchors, every Sidebar click was a full
   browser navigation (window identity itself changed across "clicks"),
   which unmounts/remounts the entire app on every nav — the exact visible
   flicker the root-layout AppShell move (see app-shell.tsx) was supposed to
   fix. Moving AppShell up doesn't help unless the links themselves also do
   client-side transitions. Since these are copy-pasted per-app files (not
   an npm package), and this app is Next.js, this is a safe local edit. */

injectOnce('ds-sidebar', `
/* !important is required here: the aside below sets display:'flex' inline
   (for its own column layout), and an inline style attribute always beats
   a class-based rule regardless of specificity, so a plain "display:none"
   here would silently never apply. Confirmed via computed-style check in
   the browser during migration verification — v0.1.2 upstream bug, patched
   locally since this is a copy-pasted (not npm-installed) component. */
@media (max-width: 1024px) { .ds-sidebar { display: none !important; } }
.ds-sidebar-link:hover:not(.ds-sidebar-link-active){background:var(--ds-color-surface-2);color:var(--ds-color-fg);}
.ds-sidebar-child:hover:not(.ds-sidebar-child-active){background:var(--ds-color-surface-2);color:var(--ds-color-fg);}
`);

function isActive(href, activeHref) {
  return href === activeHref || (href !== '/' && activeHref.startsWith(`${href}/`));
}

function SidebarItem({ item, activeHref }) {
  const active = isActive(item.href, activeHref);
  const hasChildren = item.children && item.children.length > 0;
  const showChildren = hasChildren && active;

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

export function Sidebar({ brand, items, activeHref, footer, className = '', style }) {
  return (
    <aside
      className={`ds-sidebar ${className}`.trim()}
      style={{
        width: 240, display: 'flex', flexDirection: 'column', height: '100%',
        borderRight: '1px solid var(--ds-color-border)', background: 'var(--ds-color-surface)',
        fontFamily: 'var(--ds-font-sans)', ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 56, padding: '0 20px', borderBottom: '1px solid var(--ds-color-border)' }}>
        {brand}
      </div>
      <nav style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'grid', gap: 4, alignContent: 'start' }}>
        {items.map((item) => (
          <SidebarItem key={item.href} item={item} activeHref={activeHref} />
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
