import React from 'react';
import { injectOnce } from '../_shared/injectStyle.js';
import { Icon } from '../icons/Icon.jsx';
import { Button } from '../core/Button.jsx';

injectOnce('ds-table', `
.ds-table-frame{min-width:0;max-width:100%;overflow:clip;border:1px solid var(--ds-color-border);border-radius:var(--ds-radius-lg);background:var(--ds-color-surface);}
.ds-table-scroll{width:100%;max-width:100%;min-width:0;overflow:auto;scrollbar-gutter:stable;}
.ds-table{width:100%;border-collapse:collapse;font-family:var(--ds-font-sans);font-size:var(--ds-text-sm);color:var(--ds-color-fg);}
.ds-table-strip{padding:8px 12px;background:var(--ds-color-surface-2);border-bottom:1px solid var(--ds-color-border);}
.ds-table-strip-bottom{border-bottom:0;border-top:1px solid var(--ds-color-border);}
/* Only a string caption gets label typography — uppercasing a strip that
   holds a search box would uppercase the search box. */
.ds-table-caption{color:var(--ds-color-fg-subtle);font-family:var(--ds-font-sans);font-size:var(--ds-text-xs);font-weight:var(--ds-weight-bold);letter-spacing:var(--ds-tracking-wide);text-transform:uppercase;}
.ds-table th{position:sticky;top:0;z-index:1;background:var(--ds-color-surface-2);padding:10px 12px;text-align:left;font-size:var(--ds-text-xs);font-weight:var(--ds-weight-bold);letter-spacing:var(--ds-tracking-wide);text-transform:uppercase;color:var(--ds-color-fg-subtle);border-bottom:1px solid var(--ds-color-border);white-space:nowrap;}
.ds-table td{padding:10px 12px;border-bottom:1px solid var(--ds-color-border);vertical-align:middle;}
.ds-table tbody tr:last-child td{border-bottom:0;}
/* For stat tables. An 11-column standings grid spends ~260px on horizontal
   padding at the default, which is the difference between fitting on a phone
   and not. */
.ds-table-compact th,.ds-table-compact td{padding:7px 7px;}
.ds-table-compact td{font-size:var(--ds-text-xs);}
.ds-table-hoverable tbody tr:hover td{background:var(--ds-color-surface-2);}
/* Two classes deep on purpose: .ds-table th already sets text-align:left and
   would otherwise out-specify a single .ds-table-num, leaving a numeric
   column's header sitting left of its own right-aligned numbers. */
.ds-table .ds-table-num{text-align:right;font-variant-numeric:tabular-nums;}
.ds-table-zebra tbody tr:nth-child(even) td{background:var(--ds-color-surface-2);}
.ds-table-empty{padding:40px 20px;text-align:center;color:var(--ds-color-fg-muted);}
.ds-table-sort{display:inline-flex;align-items:center;gap:4px;border:0;padding:0;margin:0;background:none;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer;}
.ds-table-sort:hover{color:var(--ds-color-fg);}
.ds-table-sort:disabled{cursor:default;}
.ds-table-sort-icon{display:inline-flex;opacity:.45;}
.ds-table-sort[data-active="true"]{color:var(--ds-color-fg);}
.ds-table-sort[data-active="true"] .ds-table-sort-icon{opacity:1;}
.ds-table-pager{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;font-family:var(--ds-font-sans);font-size:var(--ds-text-xs);color:var(--ds-color-fg-muted);}
.ds-table-pager-controls{display:flex;align-items:center;gap:12px;}
.ds-table-pager-size{display:flex;align-items:center;gap:6px;}
.ds-table-pager-size select{height:28px;border-radius:var(--ds-radius-sm);border:1px solid var(--ds-color-border);background:var(--ds-color-surface);color:var(--ds-color-fg);font-family:inherit;font-size:inherit;padding:0 6px;}
.ds-table-pager-nav{display:flex;align-items:center;gap:4px;}
.ds-table-pager-count{min-width:64px;text-align:center;font-variant-numeric:tabular-nums;}
`);

/** Presentational table: the frame, the scroll container, and header/cell
 * styling driven by tokens.
 *
 * Deliberately **not** a data grid. Sorting, pagination, column visibility
 * and virtualisation are a different problem, well solved by TanStack Table,
 * and the operator console already uses it — reimplementing that here would
 * be strictly worse. Pair this with whatever table engine you like, or use
 * it bare for a table that just needs to look right.
 *
 * The header is always sticky; `maxHeight` is what gives it something to
 * stick against, by capping the scroll container.
 */
export function Table({ caption, footer, minWidth, maxHeight, density = 'default', hoverable = true, zebra = false, children, className = '', style }) {
  const cls = ['ds-table',
    density === 'compact' && 'ds-table-compact',
    hoverable && 'ds-table-hoverable',
    zebra && 'ds-table-zebra'].filter(Boolean).join(' ');
  return (
    <div className={`ds-table-frame ${className}`.trim()} style={style}>
      {caption ? (
        <div className={`ds-table-strip ${typeof caption === 'string' ? 'ds-table-caption' : ''}`.trim()}>
          {caption}
        </div>
      ) : null}
      <div className="ds-table-scroll" style={maxHeight ? { maxHeight } : undefined}>
        <table className={cls} style={minWidth ? { minWidth } : undefined}>
          {children}
        </table>
      </div>
      {footer ? <div className="ds-table-strip ds-table-strip-bottom">{footer}</div> : null}
    </div>
  );
}

/** The contents of a sortable `<th>`: the label plus a direction arrow.
 *
 * Exists because the three apps had each invented their own indicator — text
 * arrows, Lucide icons, and `▲▼↕` — so the same interaction looked like three
 * different features. It holds no sort state; `direction` and `onSort` come
 * from whatever engine the table uses, TanStack or a `useState` pair.
 */
export function TableSortHeader({ direction = null, onSort, disabled = false, children, className = '', ...props }) {
  const icon = direction === 'asc' ? 'arrow-up' : direction === 'desc' ? 'arrow-down' : 'arrow-up-down';
  return (
    <button
      type="button"
      className={`ds-table-sort ${className}`.trim()}
      data-active={direction ? 'true' : 'false'}
      disabled={disabled || !onSort}
      onClick={onSort}
      aria-label={typeof children === 'string' ? children : undefined}
      {...props}
    >
      {children}
      {!disabled && onSort ? (
        <span className="ds-table-sort-icon" aria-hidden="true"><Icon name={icon} size={12} /></span>
      ) : null}
    </button>
  );
}

/** Row-count summary, page-size picker and prev/next, for a Table's `footer`.
 *
 * `summary` and `rowsLabel` are passed in already translated — the design
 * system has no opinion about language, and both apps have their own `t`.
 * Page numbers are 1-based here regardless of what the caller's engine uses
 * internally (TanStack's are 0-based; convert at the boundary).
 */
export function TablePager({
  summary, rowsLabel, page, pageCount,
  onPageChange, pageSize, pageSizeOptions, onPageSizeChange,
  prevLabel = 'Previous page', nextLabel = 'Next page',
}) {
  const total = Math.max(1, pageCount ?? 1);
  return (
    <div className="ds-table-pager">
      <span>{summary}</span>
      <div className="ds-table-pager-controls">
        {pageSizeOptions && onPageSizeChange ? (
          <label className="ds-table-pager-size">
            {rowsLabel ? <span>{rowsLabel}</span> : null}
            <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
              {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        ) : null}
        <div className="ds-table-pager-nav">
          <Button variant="outline" size="icon" aria-label={prevLabel}
            disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <Icon name="chevron-left" size={14} />
          </Button>
          <span className="ds-table-pager-count">{page} / {total}</span>
          <Button variant="outline" size="icon" aria-label={nextLabel}
            disabled={page >= total} onClick={() => onPageChange(page + 1)}>
            <Icon name="chevron-right" size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A "nothing here" row spanning the whole table.
 *
 * `colSpan` defaults high on purpose: browsers clamp it to the real column
 * count, and tables that build columns dynamically would otherwise have to
 * recount them just to render an empty message.
 */
export function TableEmpty({ colSpan = 99, children }) {
  return (
    <tr>
      <td className="ds-table-empty" colSpan={colSpan}>{children}</td>
    </tr>
  );
}
