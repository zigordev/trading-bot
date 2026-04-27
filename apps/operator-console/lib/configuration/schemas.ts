import { z } from "zod";

export type ConfigField =
  | {
      name: string;
      label: string;
      kind: "text";
      placeholder?: string;
      optional?: boolean;
      defaultValue?: string;
    }
  | {
      name: string;
      label: string;
      kind: "textarea";
      placeholder?: string;
      optional?: boolean;
      defaultValue?: string;
      rows?: number;
    }
  | {
      name: string;
      label: string;
      kind: "select";
      options: { value: string; label: string }[];
      defaultValue?: string;
      optional?: boolean;
    }
  | {
      name: string;
      label: string;
      kind: "number";
      placeholder?: string;
      optional?: boolean;
      defaultValue?: number;
    }
  | {
      name: string;
      label: string;
      kind: "boolean";
      defaultValue?: boolean;
    }
  | {
      name: string;
      label: string;
      kind: "symbol";
      placeholder?: string;
    }
  | {
      name: string;
      label: string;
      kind: "asset-display";
      placeholder?: string;
    }
  | {
      name: string;
      label: string;
      kind: "json";
      placeholder?: string;
      defaultValue?: string;
    }
  | {
      name: string;
      label: string;
      kind: "promotion-thresholds";
      description?: string;
    };

export type ConfigResourceDefinition = {
  key: string;
  label: string;
  endpoint: string;
  titleField: string;
  idField?: string;
  fields: ConfigField[];
  schema: z.ZodSchema;
  defaultValues: () => Record<string, unknown>;
};

const promotionThresholdsSchema = z
  .object({
    minTradeCount: z.coerce.number().min(0),
    minTradesPer1000Candles: z.coerce.number().min(0),
    maxDrawdownPercent: z.coerce.number().min(0),
    maxReversalRatio: z.coerce.number().min(0),
  })
  .partial()
  .optional();

const symbolSchema = z.object({
  code: z.string().min(1, "Pair is required"),
  baseAsset: z.string().min(1, "Base asset is required"),
  destinationAsset: z.string().min(1, "Destination asset is required"),
  active: z.boolean(),
});

const timeframeSchema = z.object({
  code: z.string().min(1, "Code is required"),
  longerTimeframeCode: z.string().min(1, "Longer timeframe code is required"),
  longerTimeframeMultiplier: z.coerce.number().min(1),
  periodMs: z.coerce.number().min(1),
  active: z.boolean(),
});

const strategySchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().default(""),
  activated: z.boolean(),
  parameters: z
    .object({
      kind: z.string().min(1, "Strategy kind is required"),
      promotionThresholds: promotionThresholdsSchema,
    })
    .passthrough(),
});

const riskProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().default(""),
  maximumStopLoss: z.coerce.number(),
  minimumStopLoss: z.coerce.number(),
  swingGap: z.coerce.number(),
  rrr: z.coerce.number(),
  enabled: z.boolean(),
});

const analysisSettingSchema = z.object({
  name: z.string().min(1, "Name is required"),
  strategyName: z.string().min(1, "Strategy is required"),
  technicalAnalysisSettings: z.record(z.unknown()).default({}),
  enabled: z.boolean(),
});

const executionSettingSchema = z.object({
  name: z.string().min(1, "Name is required"),
  enabled: z.boolean(),
  mode: z.enum(["paper", "live"]),
  autoPromote: z.boolean(),
  maxPromotions: z.coerce.number().int().min(1),
  replaceOpenPositionPolicy: z.enum(["keep", "flatten"]),
});

export const configResources: Record<string, ConfigResourceDefinition> = {
  symbols: {
    key: "symbols",
    label: "Pairs",
    endpoint: "symbols",
    titleField: "code",
    idField: "code",
    schema: symbolSchema,
    defaultValues: () => ({
      code: "",
      baseAsset: "",
      destinationAsset: "USDT",
      active: true,
    }),
    fields: [
      { name: "code", label: "Pair", kind: "symbol", placeholder: "BTCUSDT" },
      { name: "baseAsset", label: "Base asset", kind: "asset-display", placeholder: "Auto-filled from pair" },
      {
        name: "destinationAsset",
        label: "Destination asset",
        kind: "asset-display",
        placeholder: "Auto-filled from pair",
      },
      { name: "active", label: "Active", kind: "boolean" },
    ],
  },
  timeframes: {
    key: "timeframes",
    label: "Timeframes",
    endpoint: "timeframes",
    titleField: "code",
    idField: "code",
    schema: timeframeSchema,
    defaultValues: () => ({
      code: "",
      longerTimeframeCode: "",
      longerTimeframeMultiplier: 1,
      periodMs: 60000,
      active: true,
    }),
    fields: [
      { name: "code", label: "Code", kind: "text", placeholder: "1m" },
      { name: "longerTimeframeCode", label: "Longer timeframe code", kind: "text" },
      {
        name: "longerTimeframeMultiplier",
        label: "Longer timeframe multiplier",
        kind: "number",
      },
      { name: "periodMs", label: "Period (ms)", kind: "number" },
      { name: "active", label: "Active", kind: "boolean" },
    ],
  },
  strategies: {
    key: "strategies",
    label: "Strategies",
    endpoint: "strategies",
    titleField: "name",
    idField: "name",
    schema: strategySchema,
    defaultValues: () => ({
      name: "",
      description: "",
      activated: false,
      parameters: {
        kind: "strategy1",
        promotionThresholds: {
          minTradeCount: 80,
          minTradesPer1000Candles: 5,
          maxDrawdownPercent: 12,
          maxReversalRatio: 0.2,
        },
      },
    }),
    fields: [
      { name: "name", label: "Name", kind: "text" },
      { name: "description", label: "Description", kind: "textarea", rows: 2 },
      { name: "activated", label: "Activated", kind: "boolean" },
      {
        name: "parameters.kind",
        label: "Strategy kind",
        kind: "text",
        placeholder: "strategy1",
      },
      {
        name: "parameters.promotionThresholds",
        label: "Promotion thresholds",
        kind: "promotion-thresholds",
        description:
          "Backtests that meet ALL thresholds are eligible for automatic promotion.",
      },
    ],
  },
  "risk-profiles": {
    key: "risk-profiles",
    label: "Risk profiles",
    endpoint: "risk-profiles",
    titleField: "name",
    idField: "name",
    schema: riskProfileSchema,
    defaultValues: () => ({
      name: "",
      description: "",
      maximumStopLoss: 0,
      minimumStopLoss: 0,
      swingGap: 0,
      rrr: 1.5,
      enabled: true,
    }),
    fields: [
      { name: "name", label: "Name", kind: "text" },
      { name: "description", label: "Description", kind: "textarea", rows: 2 },
      { name: "maximumStopLoss", label: "Maximum stop loss", kind: "number" },
      { name: "minimumStopLoss", label: "Minimum stop loss", kind: "number" },
      { name: "swingGap", label: "Swing gap", kind: "number" },
      { name: "rrr", label: "RRR", kind: "number" },
      { name: "enabled", label: "Enabled", kind: "boolean" },
    ],
  },
  "analysis-settings": {
    key: "analysis-settings",
    label: "Analysis settings",
    endpoint: "analysis-settings",
    titleField: "name",
    idField: "name",
    schema: analysisSettingSchema,
    defaultValues: () => ({
      name: "",
      strategyName: "",
      technicalAnalysisSettings: {},
      enabled: true,
    }),
    fields: [
      { name: "name", label: "Name", kind: "text" },
      { name: "strategyName", label: "Strategy", kind: "text" },
      {
        name: "technicalAnalysisSettings",
        label: "Technical analysis settings",
        kind: "json",
        placeholder: '{\n  "fastPeriod": 9,\n  "slowPeriod": 21\n}',
      },
      { name: "enabled", label: "Enabled", kind: "boolean" },
    ],
  },
  "execution-settings": {
    key: "execution-settings",
    label: "Execution settings",
    endpoint: "execution-settings",
    titleField: "name",
    idField: "name",
    schema: executionSettingSchema,
    defaultValues: () => ({
      name: "",
      enabled: true,
      mode: "paper",
      autoPromote: true,
      maxPromotions: 1,
      replaceOpenPositionPolicy: "flatten",
    }),
    fields: [
      { name: "name", label: "Name", kind: "text" },
      { name: "enabled", label: "Enabled", kind: "boolean" },
      {
        name: "mode",
        label: "Mode",
        kind: "select",
        options: [
          { value: "paper", label: "Paper" },
          { value: "live", label: "Live" },
        ],
      },
      { name: "autoPromote", label: "Auto promote", kind: "boolean" },
      { name: "maxPromotions", label: "Max promotions", kind: "number" },
      {
        name: "replaceOpenPositionPolicy",
        label: "Replace open position policy",
        kind: "select",
        options: [
          { value: "keep", label: "Keep existing" },
          { value: "flatten", label: "Flatten" },
        ],
      },
    ],
  },
};

export const configResourceKeys = Object.keys(configResources);

export const getResource = (key: string): ConfigResourceDefinition | undefined =>
  configResources[key];
