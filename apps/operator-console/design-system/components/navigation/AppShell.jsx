import React from 'react';
import { injectOnce } from '../_shared/injectStyle.js';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { BottomNav } from './BottomNav.jsx';

injectOnce('ds-app-shell', `
.ds-app-shell-main { padding-bottom: var(--ds-space-6); }
@media (max-width: 1024px) {
  .ds-app-shell-main--with-bottom-nav { padding-bottom: calc(var(--ds-space-16) + var(--ds-space-6)); }
}
`);

function toBottomNavItems(sidebarItems, max = 5) {
  return sidebarItems
    .filter((item) => item.icon)
    .slice(0, max)
    .map(({ href, label, icon }) => ({ href, label, icon }));
}

export function AppShell({
  brand,
  sidebarItems,
  bottomNavItems,
  activeHref,
  sidebarFooter,
  topbar = {},
  hasSidebar = true,
  linkComponent = 'a',
  children,
  className = '',
  style,
}) {
  const bottomItems = bottomNavItems ?? (hasSidebar ? toBottomNavItems(sidebarItems) : []);

  return (
    <div className={`ds-app-shell ${className}`.trim()} style={{ display: 'flex', minHeight: '100vh', background: 'var(--ds-color-bg)', ...style }}>
      {hasSidebar ? (
        <Sidebar brand={brand} items={sidebarItems} activeHref={activeHref} footer={sidebarFooter} linkComponent={linkComponent} />
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0 }}>
        <Topbar brand={brand} hideBrandOnDesktop={hasSidebar} {...topbar} />
        <main
          className={`ds-app-shell-main ${bottomItems.length ? 'ds-app-shell-main--with-bottom-nav' : ''}`.trim()}
          style={{ flex: '1 1 auto', paddingTop: 'var(--ds-space-6)', paddingRight: 'var(--ds-space-6)', paddingLeft: 'var(--ds-space-6)' }}
        >
          {children}
        </main>
      </div>
      {bottomItems.length ? <BottomNav items={bottomItems} activeHref={activeHref} linkComponent={linkComponent} /> : null}
    </div>
  );
}
