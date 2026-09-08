'use client';

import * as React from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useStrategies } from '@/lib/hooks/use-strategies';
import { cn } from '@/lib/utils';

interface StrategyNameProps {
  name: string;
  className?: string;
}

export function StrategyName({ name, className }: StrategyNameProps) {
  const strategies = useStrategies();
  const description = React.useMemo(() => {
    const match = strategies.data?.find((strategy) => strategy.name === name);
    const text = typeof match?.description === 'string' ? match.description.trim() : '';
    return text.length > 0 ? text : null;
  }, [strategies.data, name]);

  if (!description) {
    return <span className={className}>{name}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            'cursor-help underline decoration-[var(--color-fg-subtle)] decoration-dotted underline-offset-4',
            className
          )}
        >
          {name}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] whitespace-normal">{description}</TooltipContent>
    </Tooltip>
  );
}
