import React from 'react';

const SIZES = {
  sm: { mark: 34, font: '0.9rem', wordmark: '0.9375rem' },
  md: { mark: 48, font: '1.125rem', wordmark: '1.125rem' },
  lg: { mark: 64, font: '1.5rem', wordmark: '1.375rem' },
};

export function Logo({
  mark,
  initials,
  wordmark,
  tagline,
  size = 'md',
  shape = 'circle',
  href,
  linkComponent = 'a',
  className = '',
  style,
}) {
  const dim = SIZES[size] ?? SIZES.md;
  const Tag = href ? linkComponent : 'span';

  return (
    <Tag
      href={href}
      className={`ds-logo ${className}`.trim()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 'var(--ds-space-3)',
        textDecoration: 'none', color: 'inherit', ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: dim.mark, height: dim.mark, flexShrink: 0, overflow: 'hidden',
          borderRadius: shape === 'circle' ? 'var(--ds-radius-full)' : 'var(--ds-radius-lg)',
          background: 'var(--ds-color-accent)', color: 'var(--ds-color-accent-fg)',
          fontFamily: 'var(--ds-font-sans)', fontWeight: 'var(--ds-weight-bold)', fontSize: dim.font,
          letterSpacing: 'var(--ds-tracking-tight)',
        }}
      >
        {mark ?? initials}
      </span>

      {wordmark ? (
        <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 'var(--ds-leading-tight)' }}>
          <span
            style={{
              fontFamily: 'var(--ds-font-sans)', fontWeight: 'var(--ds-weight-bold)', fontSize: dim.wordmark,
              color: 'var(--ds-color-fg)', letterSpacing: 'var(--ds-tracking-tight)',
            }}
          >
            {wordmark}
          </span>
          {size === 'lg' && tagline ? (
            <span
              style={{
                fontFamily: 'var(--ds-font-sans)', fontSize: 'var(--ds-text-xs)', fontWeight: 'var(--ds-weight-medium)',
                color: 'var(--ds-color-fg-subtle)', marginTop: 2,
              }}
            >
              {tagline}
            </span>
          ) : null}
        </span>
      ) : null}
    </Tag>
  );
}
