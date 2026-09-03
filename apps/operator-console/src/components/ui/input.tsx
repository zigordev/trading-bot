import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[13px] shadow-xs transition-colors',
        'placeholder:text-[var(--color-fg-faint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:border-[var(--color-accent)]',
        'disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-[12px] file:font-medium',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export { Input };
