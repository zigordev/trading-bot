import React from 'react';
import { injectOnce } from '../_shared/injectStyle.js';
import { Menu, MenuItem } from '../overlay/Menu.jsx';

injectOnce('ds-scope-switcher', `
.ds-scope-trigger{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:1px solid var(--ds-color-border);border-radius:var(--ds-radius-md);
  background:var(--ds-color-surface-2);color:var(--ds-color-fg);font-family:var(--ds-font-sans);cursor:pointer;text-align:left;
  transition:background var(--ds-duration-fast) var(--ds-ease-out),border-color var(--ds-duration-fast) var(--ds-ease-out);}
.ds-scope-trigger:hover{background:var(--ds-color-surface-3);border-color:var(--ds-color-border-strong);}
.ds-scope-trigger:focus-visible{outline:2px solid var(--ds-color-accent);outline-offset:2px;}
.ds-scope-text{display:grid;gap:1px;min-width:0;flex:1 1 auto;}
.ds-scope-label{font-size:var(--ds-text-xs);font-weight:var(--ds-weight-semibold);letter-spacing:.06em;text-transform:uppercase;color:var(--ds-color-fg-subtle);}
.ds-scope-value{font-size:var(--ds-text-sm);font-weight:var(--ds-weight-semibold);color:var(--ds-color-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ds-scope-chevron{flex-shrink:0;color:var(--ds-color-fg-subtle);}
`);

const Chevron = () => (
  <svg className="ds-scope-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const Check = ({ visible }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, opacity: visible ? 1 : 0 }}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/** The scope selector that belongs at the top of `Sidebar` — which team /
 * pool / workspace everything below is showing. Scope is not a destination:
 * it changes *what data* the whole app is about, not *where you are*, which
 * is why it sits above the nav list rather than inside it. */
export function ScopeSwitcher({
  label, value, placeholder = '—', items = [], footer, className = '', style,
}) {
  return (
    <Menu
      block
      className={className}
      style={style}
      trigger={
        <button type="button" className="ds-scope-trigger" aria-label={label}>
          <span className="ds-scope-text">
            {label ? <span className="ds-scope-label">{label}</span> : null}
            <span className="ds-scope-value">{value || placeholder}</span>
          </span>
          <Chevron />
        </button>
      }
    >
      {({ close }) => (
        <>
          {items.map((item) => (
            <MenuItem
              key={item.id}
              onClick={() => { close(); if (item.onSelect) item.onSelect(item.id); }}
            >
              <Check visible={item.active} />
              {item.label}
            </MenuItem>
          ))}
          {footer ? (
            <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--ds-color-border)' }}>
              {typeof footer === 'function' ? footer({ close }) : footer}
            </div>
          ) : null}
        </>
      )}
    </Menu>
  );
}
