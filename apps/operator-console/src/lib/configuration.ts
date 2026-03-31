export type ConfigField = {
  name: string;
  label: string;
  kind: "text" | "number" | "boolean" | "json";
  options?: string[];
  placeholder?: string;
  optional?: boolean;
  defaultValue?: string;
};

export type ConfigResource = {
  label: string;
  endpoint: string;
  titleField: string;
  fields: ConfigField[];
};

export const configResources = {
  symbols: {
    label: "Symbols",
    endpoint: "symbols",
    titleField: "code",
    fields: [
      { name: "code", label: "Symbol", kind: "text", placeholder: "BTCUSDT" },
      { name: "baseAsset", label: "Base asset", kind: "text", placeholder: "BTC" },
      {
        name: "destinationAsset",
        label: "Destination asset",
        kind: "text",
        placeholder: "USDT",
      },
      { name: "active", label: "Active", kind: "boolean" },
    ],
  },
  timeframes: {
    label: "Timeframes",
    endpoint: "timeframes",
    titleField: "code",
    fields: [
      { name: "code", label: "Code", kind: "text", placeholder: "1m" },
      {
        name: "longerTimeframeCode",
        label: "Longer timeframe code",
        kind: "text",
      },
      {
        name: "longerTimeframeMultiplier",
        label: "Longer timeframe multiplier",
        kind: "number",
      },
      { name: "periodMs", label: "Period ms", kind: "number" },
      { name: "active", label: "Active", kind: "boolean" },
    ],
  },
  strategies: {
    label: "Strategies",
    endpoint: "strategies",
    titleField: "name",
    fields: [
      { name: "name", label: "Name", kind: "text" },
      { name: "description", label: "Description", kind: "text" },
      { name: "activated", label: "Activated", kind: "boolean" },
      {
        name: "parameters",
        label: "Parameters JSON",
        kind: "json",
        placeholder: '{\n  "kind": "emaCross"\n}',
      },
    ],
  },
  "risk-profiles": {
    label: "Risk Profiles",
    endpoint: "risk-profiles",
    titleField: "name",
    fields: [
      { name: "name", label: "Name", kind: "text" },
      { name: "description", label: "Description", kind: "text" },
      { name: "maximumStopLoss", label: "Maximum stop loss", kind: "number" },
      { name: "minimumStopLoss", label: "Minimum stop loss", kind: "number" },
      { name: "swingGap", label: "Swing gap", kind: "number" },
      { name: "rrr", label: "RRR", kind: "number" },
      { name: "enabled", label: "Enabled", kind: "boolean" },
    ],
  },
  "analysis-settings": {
    label: "Analysis Settings",
    endpoint: "analysis-settings",
    titleField: "name",
    fields: [
      { name: "name", label: "Name", kind: "text" },
      { name: "strategyName", label: "Strategy name", kind: "text" },
      {
        name: "technicalAnalysisSettings",
        label: "Technical analysis settings JSON",
        kind: "json",
        placeholder: '{\n  "fastPeriod": 9,\n  "slowPeriod": 21\n}',
      },
      { name: "enabled", label: "Enabled", kind: "boolean" },
    ],
  },
  "execution-settings": {
    label: "Execution Settings",
    endpoint: "execution-settings",
    titleField: "name",
    fields: [
      { name: "name", label: "Name", kind: "text" },
      { name: "enabled", label: "Enabled", kind: "boolean", defaultValue: "true" },
      {
        name: "mode",
        label: "Mode",
        kind: "text",
        options: ["paper", "live"],
        defaultValue: "paper",
      },
      { name: "autoPromote", label: "Auto promote", kind: "boolean", defaultValue: "true" },
      {
        name: "maxPromotions",
        label: "Max promotions",
        kind: "number",
        defaultValue: "1",
      },
      {
        name: "requirePositivePnl",
        label: "Require positive PnL",
        kind: "boolean",
        defaultValue: "false",
      },
      {
        name: "minTradeCount",
        label: "Minimum trade count",
        kind: "number",
        defaultValue: "1",
      },
      {
        name: "replaceOpenPositionPolicy",
        label: "Replace open position policy",
        kind: "text",
        options: ["keep", "flatten"],
        defaultValue: "flatten",
      },
    ],
  },
} as const satisfies Record<string, ConfigResource>;

export type ConfigResourceKey = keyof typeof configResources;

export const createEmptyFormState = (
  resourceKey: ConfigResourceKey,
): Record<string, string> =>
  configResources[resourceKey].fields.reduce<Record<string, string>>(
    (accumulator, field) => {
      const defaultValue = "defaultValue" in field ? field.defaultValue : undefined;
      accumulator[field.name] =
        defaultValue ??
        (field.kind === "json" ? "{}" : field.kind === "boolean" ? "true" : "");
      return accumulator;
    },
    {},
  );

export const serializeConfigPayload = (
  fields: ConfigField[],
  values: Record<string, string>,
): Record<string, unknown> =>
  fields.reduce<Record<string, unknown>>((accumulator, field) => {
    const rawValue = values[field.name] ?? "";
    if (field.kind === "number") {
      if (!rawValue.trim() && field.optional) {
        return accumulator;
      }
      accumulator[field.name] = rawValue.trim() ? Number(rawValue) : null;
    } else if (field.kind === "boolean") {
      accumulator[field.name] = rawValue === "true";
    } else if (field.kind === "json") {
      accumulator[field.name] = rawValue.trim() ? JSON.parse(rawValue) : {};
    } else {
      accumulator[field.name] = rawValue;
    }
    return accumulator;
  }, {});
