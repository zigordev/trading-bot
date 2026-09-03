'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePreferences } from '@/components/providers/preferences-provider';

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function CopyButton({
  value,
  label: providedLabel,
  className,
  size = 'sm',
}: CopyButtonProps) {
  const { t } = usePreferences();
  const label = providedLabel ?? t('shared.copy_button.copy');
  const copiedLabel = t('shared.copy_button.copied');
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore — clipboard may be unavailable
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size === 'sm' ? 'icon-sm' : 'icon'}
          onClick={handleCopy}
          aria-label={copied ? copiedLabel : label}
          className={cn('text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]', className)}
        >
          {copied ? <Check className="text-[var(--color-success)]" /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? copiedLabel : label}</TooltipContent>
    </Tooltip>
  );
}
