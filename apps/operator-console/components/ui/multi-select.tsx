"use client";

import * as React from "react";
import { Check, ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePreferences } from "@/components/providers/preferences-provider";

export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  maxVisibleBadges?: number;
  className?: string;
  disabled?: boolean;
  triggerLabel?: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder: providedPlaceholder,
  emptyText: providedEmptyText,
  searchPlaceholder: providedSearchPlaceholder,
  maxVisibleBadges = 3,
  className,
  disabled = false,
  triggerLabel,
}: MultiSelectProps) {
  const { t } = usePreferences();
  const placeholder = providedPlaceholder ?? t("ui.multi_select.placeholder");
  const emptyText = providedEmptyText ?? t("ui.multi_select.empty_text");
  const searchPlaceholder =
    providedSearchPlaceholder ?? t("ui.multi_select.search_placeholder");
  const [open, setOpen] = React.useState(false);

  const toggle = (next: string) => {
    if (value.includes(next)) {
      onChange(value.filter((item) => item !== next));
    } else {
      onChange([...value, next]);
    }
  };

  const clear = (event: React.MouseEvent) => {
    event.stopPropagation();
    onChange([]);
  };

  const selectedOptions = value
    .map((v) => options.find((opt) => opt.value === v))
    .filter((opt): opt is MultiSelectOption => Boolean(opt));

  const visible = selectedOptions.slice(0, maxVisibleBadges);
  const overflow = selectedOptions.length - visible.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between gap-2 px-3 text-[13px] font-normal",
            !value.length && "text-[var(--color-fg-subtle)]",
            className,
          )}
        >
          <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
            {triggerLabel && (
              <span className="text-[var(--color-fg-subtle)]">
                {triggerLabel}:
              </span>
            )}
            {value.length === 0 ? (
              <span>{placeholder}</span>
            ) : (
              <div className="flex items-center gap-1 overflow-hidden">
                {visible.map((opt) => (
                  <Badge
                    key={opt.value}
                    variant="outline"
                    className="max-w-[120px] truncate bg-[var(--color-surface-2)]"
                  >
                    {opt.label}
                  </Badge>
                ))}
                {overflow > 0 && (
                  <Badge variant="outline" className="bg-[var(--color-surface-2)]">
                    +{overflow}
                  </Badge>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {value.length > 0 && !disabled && (
              <button
                type="button"
                onClick={clear}
                className="rounded-sm p-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                aria-label={t("ui.multi_select.clear_selection")}
              >
                <X className="size-3" />
              </button>
            )}
            <ChevronDown className="size-3.5 text-[var(--color-fg-subtle)]" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0"
        align="start"
        sideOffset={4}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const selected = value.includes(opt.value);
                return (
                  <CommandItem
                    key={opt.value}
                    value={`${opt.label} ${opt.value}`}
                    onSelect={() => toggle(opt.value)}
                    className="gap-2"
                  >
                    <div
                      className={cn(
                        "flex size-4 items-center justify-center rounded-[4px] border",
                        selected
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                          : "border-[var(--color-border)]",
                      )}
                    >
                      {selected && <Check className="size-3" />}
                    </div>
                    {opt.icon && (
                      <span className="inline-flex shrink-0 items-center text-[var(--color-fg-subtle)]">
                        {opt.icon}
                      </span>
                    )}
                    <span className="flex-1 truncate">{opt.label}</span>
                    {opt.description && (
                      <span className="text-[11px] text-[var(--color-fg-subtle)]">
                        {opt.description}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
