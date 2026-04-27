"use client";

import * as React from "react";
import { X } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StickyFiltersBar } from "@/components/layout/sticky-filters-bar";
import { SymbolAvatar } from "@/components/shared/symbol-avatar";
import { splitSymbol } from "@/lib/backtesting/derive-rows";
import type { ExecutionTrade } from "@/lib/api";

const STATUS_OPTIONS: { value: ExecutionTrade["status"]; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
];

interface ExecutionFiltersProps {
  symbols: string[];
  selectedSymbol: string;
  onSymbolChange: (next: string) => void;

  timeframes: string[];
  selectedTimeframe: string;
  onTimeframeChange: (next: string) => void;

  strategies: string[];
  selectedStrategy: string;
  onStrategyChange: (next: string) => void;

  selectedSide: "all" | "long" | "short";
  onSideChange: (next: "all" | "long" | "short") => void;

  selectedStatuses: string[];
  onStatusesChange: (next: string[]) => void;

  dateRange: DateRange | undefined;
  onDateRangeChange: (next: DateRange | undefined) => void;

  search: string;
  onSearchChange: (next: string) => void;

  onClearAll: () => void;
  hasActiveFilters: boolean;
  topOffset?: number;
  toolbar?: React.ReactNode;
}

export function ExecutionFilters({
  symbols,
  selectedSymbol,
  onSymbolChange,
  timeframes,
  selectedTimeframe,
  onTimeframeChange,
  strategies,
  selectedStrategy,
  onStrategyChange,
  selectedSide,
  onSideChange,
  selectedStatuses,
  onStatusesChange,
  dateRange,
  onDateRangeChange,
  search,
  onSearchChange,
  onClearAll,
  hasActiveFilters,
  topOffset,
  toolbar,
}: ExecutionFiltersProps) {
  const statusOptions: MultiSelectOption[] = STATUS_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));

  const chips: React.ReactNode[] = [];
  if (search) {
    chips.push(
      <FilterChip key="q" label={`search "${search}"`} onClear={() => onSearchChange("")} />,
    );
  }
  if (selectedSymbol !== "all") {
    const { base, quote } = splitSymbol(selectedSymbol);
    chips.push(
      <FilterChip
        key="sym"
        label={
          <span className="inline-flex items-center gap-1.5">
            <SymbolAvatar baseAsset={base} quoteAsset={quote} size={14} />
            {selectedSymbol}
          </span>
        }
        onClear={() => onSymbolChange("all")}
      />,
    );
  }
  if (selectedTimeframe !== "all") {
    chips.push(
      <FilterChip
        key="tf"
        label={`tf: ${selectedTimeframe}`}
        onClear={() => onTimeframeChange("all")}
      />,
    );
  }
  if (selectedStrategy !== "all") {
    chips.push(
      <FilterChip
        key="strategy"
        label={`strategy: ${selectedStrategy}`}
        onClear={() => onStrategyChange("all")}
      />,
    );
  }
  if (selectedSide !== "all") {
    chips.push(
      <FilterChip
        key="side"
        label={`side: ${selectedSide}`}
        onClear={() => onSideChange("all")}
      />,
    );
  }
  for (const status of selectedStatuses) {
    chips.push(
      <FilterChip
        key={`status-${status}`}
        label={status}
        onClear={() => onStatusesChange(selectedStatuses.filter((s) => s !== status))}
      />,
    );
  }
  if (dateRange?.from) {
    chips.push(
      <FilterChip
        key="range"
        label={`opened: range`}
        onClear={() => onDateRangeChange(undefined)}
      />,
    );
  }

  return (
    <StickyFiltersBar
      topOffset={topOffset}
      chips={
        chips.length > 0 || hasActiveFilters ? (
          <>
            {chips}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={onClearAll}
                className="ml-1 text-[11px] font-medium text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
              >
                Clear all
              </button>
            )}
          </>
        ) : null
      }
    >
      <div className="min-w-[220px] flex-1">
        <input
          placeholder="Search pair, strategy, order ID…"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] outline-none transition-colors placeholder:text-[var(--color-fg-faint)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
        />
      </div>
      <Select value={selectedSymbol} onValueChange={onSymbolChange}>
        <SelectTrigger className="h-9 w-[180px]">
          <SelectValue placeholder="Pair" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All pairs</SelectItem>
          {symbols.map((symbol) => {
            const { base, quote } = splitSymbol(symbol);
            return (
              <SelectItem key={symbol} value={symbol}>
                <span className="inline-flex items-center gap-2">
                  <SymbolAvatar baseAsset={base} quoteAsset={quote} size={16} />
                  {symbol}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Select value={selectedTimeframe} onValueChange={onTimeframeChange}>
        <SelectTrigger className="h-9 w-[120px]">
          <SelectValue placeholder="Timeframe" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All TF</SelectItem>
          {timeframes.map((tf) => (
            <SelectItem key={tf} value={tf}>
              {tf}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selectedStrategy} onValueChange={onStrategyChange}>
        <SelectTrigger className="h-9 w-[160px]">
          <SelectValue placeholder="Strategy" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All strategies</SelectItem>
          {strategies.map((strategy) => (
            <SelectItem key={strategy} value={strategy}>
              {strategy}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selectedSide} onValueChange={(next) => onSideChange(next as typeof selectedSide)}>
        <SelectTrigger className="h-9 w-[110px]">
          <SelectValue placeholder="Side" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any side</SelectItem>
          <SelectItem value="long">Long</SelectItem>
          <SelectItem value="short">Short</SelectItem>
        </SelectContent>
      </Select>
      <div className="w-[170px]">
        <MultiSelect
          options={statusOptions}
          value={selectedStatuses}
          onChange={onStatusesChange}
          placeholder="All statuses"
          searchPlaceholder="Search statuses…"
          triggerLabel="Status"
        />
      </div>
      <DateRangePicker
        value={dateRange}
        onChange={onDateRangeChange}
        placeholder="Opened range"
        className="w-[230px]"
      />
      {toolbar && <div className="ml-auto flex items-center gap-2">{toolbar}</div>}
    </StickyFiltersBar>
  );
}

function FilterChip({ label, onClear }: { label: React.ReactNode; onClear: () => void }) {
  return (
    <Badge variant="outline" className="gap-1 pr-1">
      {label}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onClear}
        className="size-4 rounded-full p-0 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
        aria-label="Remove filter"
      >
        <X className="size-2.5" />
      </Button>
    </Badge>
  );
}
