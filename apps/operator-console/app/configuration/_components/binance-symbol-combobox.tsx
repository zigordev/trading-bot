"use client";

import * as React from "react";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { SymbolAvatar } from "@/components/shared/symbol-avatar";
import { useBinanceSymbols } from "@/lib/hooks/use-binance-symbols";
import { usePreferences } from "@/components/providers/preferences-provider";

interface BinanceSymbolComboboxProps {
  value: string | null;
  onChange: (value: string | null, base?: string, dest?: string) => void;
  placeholder?: string;
}

export function BinanceSymbolCombobox({
  value,
  onChange,
  placeholder,
}: BinanceSymbolComboboxProps) {
  const { t } = usePreferences();
  const [search, setSearch] = React.useState("");
  const { data, isLoading } = useBinanceSymbols(search);

  const baseList = React.useMemo(() => data ?? [], [data]);

  const options = React.useMemo<ComboboxOption[]>(() => {
    const next: ComboboxOption[] = baseList.map((item) => ({
      value: item.symbol,
      label: item.symbol,
      description: `${item.baseAsset} → ${item.destinationAsset}`,
      icon: (
        <SymbolAvatar
          baseAsset={item.baseAsset}
          quoteAsset={item.destinationAsset}
          size={16}
        />
      ),
    }));
    if (value && !next.some((opt) => opt.value === value)) {
      next.unshift({ value, label: value });
    }
    return next;
  }, [baseList, value]);

  return (
    <Combobox
      options={options}
      value={value}
      onChange={(next) => {
        if (next === null) {
          onChange(null);
          return;
        }
        const match = baseList.find((item) => item.symbol === next);
        onChange(next, match?.baseAsset, match?.destinationAsset);
      }}
      onSearch={setSearch}
      loading={isLoading}
      placeholder={placeholder ?? t("configuration.combobox.placeholder")}
      searchPlaceholder={t("configuration.combobox.search_placeholder")}
      emptyText={t("configuration.combobox.empty")}
    />
  );
}
