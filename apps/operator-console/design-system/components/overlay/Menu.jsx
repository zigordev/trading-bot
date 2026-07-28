import React, { useEffect, useRef, useState } from 'react';

export function Menu({ trigger, children, align = 'end', block = false, className = '', style }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      const target = event.target;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`ds-menu ${className}`.trim()} style={{ position: 'relative', display: block ? 'block' : 'inline-flex', ...style }}>
      <span ref={anchorRef} onClick={() => setOpen((v) => !v)} style={{ display: block ? 'block' : 'inline-flex' }}>
        {trigger}
      </span>
      {open ? (
        <div
          ref={panelRef}
          role="menu"
          className="ds-menu-panel"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)',
            // `block` stretches the panel to the trigger's width (a sidebar
            // scope switcher looks wrong with a narrow panel under a wide
            // button); otherwise it hugs its content off the chosen edge.
            ...(block ? { left: 0, right: 0 } : { [align === 'start' ? 'left' : 'right']: 0 }),
            minWidth: 180, zIndex: 1000, padding: 6, display: 'grid', gap: 2,
            background: 'var(--ds-color-surface)', border: '1px solid var(--ds-color-border)',
            borderRadius: 'var(--ds-radius-md)', boxShadow: 'var(--ds-shadow-lg)',
            fontFamily: 'var(--ds-font-sans)',
          }}
        >
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({ children, onClick, className = '', style, ...props }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`ds-menu-item ${className}`.trim()}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '8px 10px', border: 0, background: 'transparent', borderRadius: 'var(--ds-radius-md)',
        fontSize: 'var(--ds-text-sm)', fontWeight: 'var(--ds-weight-medium)', color: 'var(--ds-color-fg)',
        cursor: 'pointer', ...style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ds-color-surface-2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      {...props}
    >
      {children}
    </button>
  );
}
