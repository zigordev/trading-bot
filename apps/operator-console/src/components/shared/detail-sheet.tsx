'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface DetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  side?: 'right' | 'left';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerAccessory?: React.ReactNode;
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<DetailSheetProps['size']>, string> = {
  sm: 'sm:max-w-[480px]',
  md: 'sm:max-w-[640px]',
  lg: 'sm:max-w-[760px]',
};

export function DetailSheet({
  open,
  onOpenChange,
  title,
  description,
  side = 'right',
  size = 'md',
  children,
  footer,
  headerAccessory,
  className,
}: DetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className={cn('flex w-full flex-col gap-0 p-0', SIZE_CLASS[size], className)}
      >
        <SheetHeader className="border-b border-[var(--color-border)] p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-[15px]">{title}</SheetTitle>
              {description && (
                <SheetDescription className="mt-1 text-[12px]">{description}</SheetDescription>
              )}
            </div>
            {headerAccessory}
          </div>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
