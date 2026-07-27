import React from 'react';
import { injectOnce } from '../_shared/injectStyle.js';

injectOnce('ds-topbar', `
.ds-topbar{position:sticky;top:0;z-index:50;background:var(--ds-color-surface-translucent);
  backdrop-filter:blur(var(--ds-color-surface-blur));-webkit-backdrop-filter:blur(var(--ds-color-surface-blur));
  border-bottom:1px solid var(--ds-color-border);}
.ds-topbar-tabs{display:flex;align-items:center;gap:var(--ds-space-2);overflow-x:auto;scrollbar-width:none;}
.ds-topbar-tabs::-webkit-scrollbar{display:none;}
.ds-topbar-brand{display:flex;flex-shrink:0;}
@media (min-width: 1025px) { .ds-topbar-brand--hide-desktop{display:none;} }
@media (max-width: 1024px) {
  .ds-topbar-row { flex-wrap: wrap; row-gap: var(--ds-space-2); }
  .ds-topbar-row > .ds-topbar-header-text { flex-basis: 100%; }
}
`);

export function Topbar({
  brand, title, description, meta, actions, utilities, tabs, subBar,
  hideBrandOnDesktop = true, className = '', style,
}) {
  const hasHeaderText = Boolean(title || description || meta);

  return (
    <header className={`ds-topbar ${className}`.trim()} style={style}>
      <div className="ds-topbar-row" style={{ display: 'flex', alignItems: 'center', gap: 'var(--ds-space-4)', minHeight: 56, padding: '0 var(--ds-space-5)' }}>
        {brand ? (
          <div className={`ds-topbar-brand ${hideBrandOnDesktop ? 'ds-topbar-brand--hide-desktop' : ''}`.trim()}>
            {brand}
          </div>
        ) : null}

        {hasHeaderText ? (
          <div className="ds-topbar-header-text" style={{ display: 'grid', gap: 2, minWidth: 0, flex: '1 1 auto' }}>
            {title ? (
              <h1 style={{ margin: 0, fontSize: 'var(--ds-text-lg)', fontWeight: 'var(--ds-weight-bold)', color: 'var(--ds-color-fg)', letterSpacing: 'var(--ds-tracking-tight)' }}>
                {title}
              </h1>
            ) : null}
            {description ? (
              <p style={{ margin: 0, fontSize: 'var(--ds-text-sm)', color: 'var(--ds-color-fg-muted)' }}>{description}</p>
            ) : null}
            {meta ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--ds-space-3)', fontSize: 'var(--ds-text-xs)', color: 'var(--ds-color-fg-subtle)' }}>
                {meta}
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ flex: '1 1 auto' }} />
        )}

        {actions ? <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ds-space-2)', flexShrink: 0 }}>{actions}</div> : null}
        {utilities ? <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ds-space-1)', flexShrink: 0 }}>{utilities}</div> : null}
      </div>

      {tabs ? (
        <div className="ds-topbar-tabs" style={{ padding: '0 var(--ds-space-5) var(--ds-space-2)' }}>
          {tabs}
        </div>
      ) : null}

      {subBar ? (
        <div style={{ borderTop: '1px solid var(--ds-color-border)', padding: 'var(--ds-space-2) var(--ds-space-5)' }}>
          {subBar}
        </div>
      ) : null}
    </header>
  );
}
