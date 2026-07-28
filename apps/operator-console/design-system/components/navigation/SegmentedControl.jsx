import React from 'react';
import { injectOnce } from '../_shared/injectStyle.js';

injectOnce('ds-segmented', `
.ds-segmented{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:var(--ds-radius-full);background:var(--ds-color-surface-2);border:1px solid var(--ds-color-border);
  transition:background var(--ds-duration-base) var(--ds-ease-out),border-color var(--ds-duration-base) var(--ds-ease-out);}
.ds-segment{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:5px 14px;border-radius:var(--ds-radius-full);
  font-family:var(--ds-font-sans);font-size:var(--ds-text-sm);font-weight:var(--ds-weight-semibold);color:var(--ds-color-fg-muted);
  cursor:pointer;white-space:nowrap;text-decoration:none;transition:background var(--ds-duration-fast) var(--ds-ease-out),color var(--ds-duration-fast) var(--ds-ease-out);}
.ds-segment:hover:not(.ds-segment-active){color:var(--ds-color-fg);}
.ds-segment-active{background:var(--ds-color-surface);color:var(--ds-color-accent);box-shadow:var(--ds-shadow-sm);}
.ds-segmented-danger{background:var(--ds-color-danger-bg);border-color:var(--ds-color-danger-border);}
.ds-segmented-danger .ds-segment-active{background:var(--ds-color-danger);color:var(--ds-color-accent-fg);}
.ds-segmented-danger .ds-segment{color:var(--ds-color-danger-fg);}
`);

/** Segmented pill control. Two uses, same shape:
 *  - a mode switch in chrome (Topbar's `mode` slot) — View/Manage, Paper/Live
 *  - a non-navigational toggle inside page content — view switchers, filters
 *
 * Give an option an `href` to render real links, so the mode stays
 * deep-linkable and shareable; omit it for controlled `value`/`onChange`
 * behaviour. Mark an option `tone: 'danger'` when selecting it carries
 * real-world consequences (live trading, production data) — the whole
 * control then repaints, so the dangerous mode can't be mistaken for the
 * safe one at a glance. */
export function SegmentedControl({
  options, value, onChange, linkComponent = 'a', ariaLabel, className = '', style,
}) {
  const Link = linkComponent;
  const navigational = options.some((option) => option.href);
  const dangerActive = options.some((option) => option.value === value && option.tone === 'danger');

  return (
    <div
      className={`ds-segmented ${dangerActive ? 'ds-segmented-danger' : ''} ${className}`.trim()}
      role={navigational ? undefined : 'tablist'}
      aria-label={ariaLabel}
      style={style}
    >
      {options.map((option) => {
        const active = option.value === value;
        const cls = `ds-segment ${active ? 'ds-segment-active' : ''}`.trim();

        return option.href ? (
          <Link key={option.value} href={option.href} className={cls} aria-current={active ? 'page' : undefined}>
            {option.icon}
            {option.label}
          </Link>
        ) : (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={cls}
            onClick={() => onChange && onChange(option.value)}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
