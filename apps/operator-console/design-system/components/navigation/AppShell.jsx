import React from 'react';
import { injectOnce } from '../_shared/injectStyle.js';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { BottomNav } from './BottomNav.jsx';

injectOnce('ds-app-shell', `
.ds-app-shell-main { flex: 1 1 auto; min-width: 0; }
/* The content frame. Every screen in every app sits in this box, so the
   gutter is defined once here — an app that pads again inside it ends up
   visibly narrower than its siblings for no stated reason. */
.ds-app-shell-content {
  width: 100%;
  margin-inline: auto;
  padding: var(--ds-space-6) var(--ds-space-6) var(--ds-space-6);
}
@media (max-width: 640px) {
  .ds-app-shell-content { padding: var(--ds-space-4) var(--ds-space-4) var(--ds-space-4); }
}
@media (max-width: 1024px) {
  .ds-app-shell-main--with-bottom-nav .ds-app-shell-content { padding-bottom: calc(var(--ds-space-16) + var(--ds-space-6)); }
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
  scope,
  sidebarItems,
  bottomNavItems,
  activeHref,
  sidebarFooter,
  topbar = {},
  hasSidebar = true,
  contentMaxWidth,
  linkComponent = 'a',
  children,
  className = '',
  style,
}) {
  const bottomItems = bottomNavItems ?? (hasSidebar ? toBottomNavItems(sidebarItems) : []);

  return (
    <div className={`ds-app-shell ${className}`.trim()} style={{ display: 'flex', minHeight: '100vh', background: 'var(--ds-color-bg)', ...style }}>
      {hasSidebar ? (
        <Sidebar brand={brand} scope={scope} items={sidebarItems} activeHref={activeHref} footer={sidebarFooter} linkComponent={linkComponent} />
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0 }}>
        {/* Scope lives at the top of the Sidebar, but the Sidebar is hidden
            below the nav breakpoint — so it also renders into the Topbar on
            mobile, otherwise switching team/pool becomes impossible there. */}
        <Topbar
          brand={brand}
          hideBrandOnDesktop={hasSidebar}
          {...topbar}
          scope={scope && hasSidebar ? <div className="ds-hide-desktop" style={{ minWidth: 0 }}>{scope}</div> : topbar.scope}
        />
        <main className={`ds-app-shell-main ${bottomItems.length ? 'ds-app-shell-main--with-bottom-nav' : ''}`.trim()}>
          <div className="ds-app-shell-content" style={contentMaxWidth ? { maxWidth: contentMaxWidth } : undefined}>
            {children}
          </div>
        </main>
      </div>
      {bottomItems.length ? <BottomNav items={bottomItems} activeHref={activeHref} linkComponent={linkComponent} /> : null}
    </div>
  );
}
