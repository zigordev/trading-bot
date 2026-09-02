'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { truncateMiddle } from '@/lib/format';
import { CopyButton } from '@/components/shared/copy-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface IdCellProps {
  value: string | null | undefined;
  head?: number;
  tail?: number;
  className?: string;
  hideCopy?: boolean;
}

export function IdCell({ value, head = 6, tail = 4, className, hideCopy = false }: IdCellProps) {
  if (!value) {
    return <span className="text-[var(--color-fg-subtle)]">—</span>;
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[12px] text-[var(--color-fg-muted)]',
        className
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{truncateMiddle(value, head, tail)}</span>
        </TooltipTrigger>
        <TooltipContent className="font-mono text-[11px]">{value}</TooltipContent>
      </Tooltip>
      {!hideCopy && <CopyButton value={value} className="size-6" />}
    </span>
  );
}
