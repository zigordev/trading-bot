"use client";

import * as React from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";
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

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  onSearch?: (query: string) => void;
  loading?: boolean;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  onSearch,
  loading = false,
  allowClear = true,
  disabled = false,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = options.find((o) => o.value === value) ?? null;

  React.useEffect(() => {
    if (!onSearch) return;
    const handle = window.setTimeout(() => onSearch(query), 200);
    return () => window.clearTimeout(handle);
  }, [query, onSearch]);

  const clear = (event: React.MouseEvent) => {
    event.stopPropagation();
    onChange(null);
  };

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
            !selected && "text-[var(--color-fg-subtle)]",
            className,
          )}
        >
          <div className="flex flex-1 items-center gap-2 overflow-hidden">
            {selected?.icon && (
              <span className="inline-flex shrink-0 items-center text-[var(--color-fg-subtle)]">
                {selected.icon}
              </span>
            )}
            <span className="truncate">{selected ? selected.label : placeholder}</span>
          </div>
          <div className="flex items-center gap-1">
            {allowClear && selected && !disabled && (
              <button
                type="button"
                onClick={clear}
                className="rounded-sm p-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                aria-label="Clear selection"
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
        <Command shouldFilter={!onSearch}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-[var(--color-fg-subtle)]">
                <Loader2 className="size-3.5 animate-spin" />
                Loading…
              </div>
            ) : (
              <>
                <CommandEmpty>{emptyText}</CommandEmpty>
                <CommandGroup>
                  {options.map((opt) => (
                    <CommandItem
                      key={opt.value}
                      value={`${opt.label} ${opt.value}`}
                      onSelect={() => {
                        onChange(opt.value === value ? null : opt.value);
                        setOpen(false);
                      }}
                      className="gap-2"
                    >
                      <Check
                        className={cn(
                          "size-3.5",
                          opt.value === value
                            ? "text-[var(--color-accent)]"
                            : "opacity-0",
                        )}
                      />
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
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
