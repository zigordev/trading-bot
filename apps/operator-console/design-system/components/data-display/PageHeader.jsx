import React from 'react';
import { injectOnce } from '../_shared/injectStyle.js';

injectOnce('ds-page-header', `
.ds-page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--ds-space-4);flex-wrap:wrap;margin-bottom:var(--ds-space-5);}
.ds-page-header-text{display:grid;gap:4px;min-width:0;flex:1 1 22rem;}
.ds-page-header-actions{display:flex;align-items:center;gap:var(--ds-space-2);flex-wrap:wrap;}
`);

/** The title block at the top of a screen's content: eyebrow, title,
 * description, and the actions that belong to the screen as a whole.
 *
 * This is page content, not chrome — it scrolls away. `Topbar` has its own
 * `title`/`actions` slots for the sticky variant; use those when the title
 * must stay visible, and this when the screen reads as a document. Pick one
 * per screen: showing both is the most common way an app ends up saying the
 * same thing twice in two type sizes. */
export function PageHeader({ eyebrow, title, description, actions, className = '', style }) {
  return (
    <header className={`ds-page-header ${className}`.trim()} style={style}>
      <div className="ds-page-header-text">
        {eyebrow ? (
          <p style={{ margin: 0, fontSize: 'var(--ds-text-xs)', fontWeight: 'var(--ds-weight-bold)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ds-color-accent)' }}>
            {eyebrow}
          </p>
        ) : null}
        {title ? (
          <h1 style={{ margin: 0, fontSize: 'var(--ds-text-2xl)', fontWeight: 'var(--ds-weight-bold)', letterSpacing: 'var(--ds-tracking-tight)', color: 'var(--ds-color-fg)' }}>
            {title}
          </h1>
        ) : null}
        {description ? (
          <p style={{ margin: 0, fontSize: 'var(--ds-text-sm)', color: 'var(--ds-color-fg-muted)', maxWidth: '68ch' }}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="ds-page-header-actions">{actions}</div> : null}
    </header>
  );
}
