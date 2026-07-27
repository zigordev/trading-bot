"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { RowStatus } from "@/lib/backtesting/types";
import { usePreferences } from "@/components/providers/preferences-provider";

const STATUS_OPTIONS: { value: RowStatus; labelKey: string }[] = [
  { value: "ready", labelKey: "backtesting.filters.status.ready" },
  { value: "partial", labelKey: "backtesting.filters.status.partial" },
  { value: "missing", labelKey: "backtesting.filters.status.missing" },
  { value: "error", labelKey: "backtesting.filters.status.error" },
];

interface BacktestingFiltersProps {
  symbols: string[];
  selectedSymbols: string[];
  onSymbolsChange: (next: string[]) => void;

  timeframes: string[];
  selectedTimeframe: string;
  onTimeframeChange: (next: string) => void;

  strategies: string[];
  selectedStrategy: string;
  onStrategyChange: (next: string) => void;

  selectedStatuses: string[];
  onStatusesChange: (next: string[]) => void;

  search: string;
  onSearchChange: (next: string) => void;

  toolbar?: React.ReactNode;
  onClearAll: () => void;
  hasActiveFilters: boolean;
  topOffset?: number;
}

export function BacktestingFilters({
  symbols,
  selectedSymbols,
  onSymbolsChange,
  timeframes,
  selectedTimeframe,
  onTimeframeChange,
  strategies,
  selectedStrategy,
  onStrategyChange,
  selectedStatuses,
  onStatusesChange,
  search,
  onSearchChange,
  toolbar,
  onClearAll,
  hasActiveFilters,
  topOffset,
}: BacktestingFiltersProps) {
  const { t } = usePreferences();
  const symbolOptions: MultiSelectOption[] = symbols.map((symbol) => {
    const { base, quote } = splitSymbol(symbol);
    return {
      value: symbol,
      label: symbol,
      icon: <SymbolAvatar baseAsset={base} quoteAsset={quote} size={16} />,
    };
  });
  const statusOptions: MultiSelectOption[] = STATUS_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
  }));
  const statusLabelByValue = new Map(
    STATUS_OPTIONS.map((opt) => [opt.value, t(opt.labelKey)]),
  );

  const chips: React.ReactNode[] = [];
  if (search) {
    chips.push(
      <FilterChip
        key="search"
        label={t("backtesting.filters.chip_search", { search })}
        onClear={() => onSearchChange("")}
      />,
    );
  }
  if (selectedTimeframe !== "all") {
    chips.push(
      <FilterChip
        key="tf"
        label={t("backtesting.filters.chip_timeframe", { timeframe: selectedTimeframe })}
        onClear={() => onTimeframeChange("all")}
      />,
    );
  }
  if (selectedStrategy !== "all") {
    chips.push(
      <FilterChip
        key="strategy"
        label={t("backtesting.filters.chip_strategy", { strategy: selectedStrategy })}
        onClear={() => onStrategyChange("all")}
      />,
    );
  }
  for (const sym of selectedSymbols) {
    const { base, quote } = splitSymbol(sym);
    chips.push(
      <FilterChip
        key={`sym-${sym}`}
        label={
          <span className="inline-flex items-center gap-1.5">
            <SymbolAvatar baseAsset={base} quoteAsset={quote} size={14} />
            {sym}
          </span>
        }
        onClear={() => onSymbolsChange(selectedSymbols.filter((s) => s !== sym))}
      />,
    );
  }
  for (const status of selectedStatuses) {
    chips.push(
      <FilterChip
        key={`status-${status}`}
        label={statusLabelByValue.get(status as RowStatus) ?? status}
        onClear={() => onStatusesChange(selectedStatuses.filter((s) => s !== status))}
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
                {t("backtesting.filters.clear_all")}
              </button>
            )}
          </>
        ) : null
      }
    >
      <div className="min-w-[200px] flex-1">
        <input
          placeholder={t("backtesting.filters.search_placeholder")}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] outline-none transition-colors placeholder:text-[var(--color-fg-faint)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
        />
      </div>
      <div className="w-[220px]">
        <MultiSelect
          options={symbolOptions}
          value={selectedSymbols}
          onChange={onSymbolsChange}
          placeholder={t("backtesting.filters.pairs.placeholder")}
          searchPlaceholder={t("backtesting.filters.pairs.search_placeholder")}
          triggerLabel={t("backtesting.filters.pairs.trigger_label")}
        />
      </div>
      <Select value={selectedTimeframe} onValueChange={onTimeframeChange}>
        <SelectTrigger className="h-9 w-[140px]">
          <SelectValue placeholder={t("backtesting.filters.timeframe.placeholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("backtesting.filters.timeframe.all")}</SelectItem>
          {timeframes.map((tf) => (
            <SelectItem key={tf} value={tf}>
              {tf}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selectedStrategy} onValueChange={onStrategyChange}>
        <SelectTrigger className="h-9 w-[180px]">
          <SelectValue placeholder={t("backtesting.filters.strategy.placeholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("backtesting.filters.strategy.all")}</SelectItem>
          {strategies.map((strategy) => (
            <SelectItem key={strategy} value={strategy}>
              {strategy}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="w-[180px]">
        <MultiSelect
          options={statusOptions}
          value={selectedStatuses}
          onChange={onStatusesChange}
          placeholder={t("backtesting.filters.status.placeholder")}
          searchPlaceholder={t("backtesting.filters.status.search_placeholder")}
          triggerLabel={t("backtesting.filters.status.trigger_label")}
        />
      </div>
      <div className="ml-auto flex items-center gap-2">{toolbar}</div>
    </StickyFiltersBar>
  );
}

function FilterChip({ label, onClear }: { label: React.ReactNode; onClear: () => void }) {
  const { t } = usePreferences();
  return (
    <Badge variant="outline" className="gap-1 pr-1">
      {label}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onClear}
        className="size-4 rounded-full p-0 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
        aria-label={t("backtesting.filters.remove_filter")}
      >
        <X className="size-2.5" />
      </Button>
    </Badge>
  );
}
