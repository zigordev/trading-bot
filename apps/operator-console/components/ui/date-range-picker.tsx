'use client';

import * as React from 'react';
import { CalendarIcon, X } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePreferences } from '@/components/providers/preferences-provider';

type Preset = {
  label: string;
  getRange: () => DateRange;
};

const compactDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  year: '2-digit',
});

interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  placeholder?: string;
  presets?: Preset[];
  className?: string;
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
  numberOfMonths?: number;
}

export function DateRangePicker({
  value,
  onChange,
  placeholder: providedPlaceholder,
  presets: providedPresets,
  className,
  align = 'start',
  disabled,
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const { t } = usePreferences();
  const placeholder = providedPlaceholder ?? t('ui.date_range_picker.placeholder');
  const defaultPresets = React.useMemo<Preset[]>(
    () => [
      {
        label: t('ui.date_range_picker.preset_24h'),
        getRange: () => ({
          from: new Date(Date.now() - 24 * 60 * 60 * 1000),
          to: new Date(),
        }),
      },
      {
        label: t('ui.date_range_picker.preset_7d'),
        getRange: () => ({
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          to: new Date(),
        }),
      },
      {
        label: t('ui.date_range_picker.preset_30d'),
        getRange: () => ({
          from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          to: new Date(),
        }),
      },
      {
        label: t('ui.date_range_picker.preset_90d'),
        getRange: () => ({
          from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          to: new Date(),
        }),
      },
    ],
    [t]
  );
  const presets = providedPresets ?? defaultPresets;
  const [open, setOpen] = React.useState(false);

  const label = (() => {
    if (!value?.from) return placeholder;
    if (!value.to) return compactDate.format(value.from);
    return `${compactDate.format(value.from)} → ${compactDate.format(value.to)}`;
  })();

  const clear = (event: React.MouseEvent) => {
    event.stopPropagation();
    onChange(undefined);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-9 justify-start gap-2 px-3 text-[13px] font-normal',
            !value?.from && 'text-[var(--color-fg-subtle)]',
            className
          )}
        >
          <CalendarIcon className="size-3.5 text-[var(--color-fg-subtle)]" />
          <span className="flex-1 truncate text-left">{label}</span>
          {value?.from && !disabled && (
            <button
              type="button"
              onClick={clear}
              className="rounded-sm p-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
              aria-label={t('ui.date_range_picker.clear_date_range')}
            >
              <X className="size-3" />
            </button>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align} sideOffset={4}>
        <div className="flex">
          <div className="flex flex-col border-r border-[var(--color-border)] p-2">
            <span className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">
              {t('ui.date_range_picker.quick_ranges')}
            </span>
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  onChange(preset.getRange());
                }}
                className="rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-2)]"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="mt-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px] text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)]"
            >
              {t('ui.date_range_picker.clear')}
            </button>
          </div>
          <Calendar
            mode="range"
            selected={value}
            onSelect={onChange}
            numberOfMonths={numberOfMonths}
            defaultMonth={value?.from ?? new Date()}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
