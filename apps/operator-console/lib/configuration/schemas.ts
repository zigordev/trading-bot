import { z } from "zod";

export type ConfigField =
  | {
      name: string;
      labelKey: string;
      kind: "text";
      placeholder?: string;
      optional?: boolean;
      defaultValue?: string;
    }
  | {
      name: string;
      labelKey: string;
      kind: "textarea";
      placeholder?: string;
      optional?: boolean;
      defaultValue?: string;
      rows?: number;
    }
  | {
      name: string;
      labelKey: string;
      kind: "select";
      options: { value: string; labelKey: string }[];
      defaultValue?: string;
      optional?: boolean;
    }
  | {
      name: string;
      labelKey: string;
      kind: "number";
      placeholder?: string;
      optional?: boolean;
      defaultValue?: number;
    }
  | {
      name: string;
      labelKey: string;
      kind: "boolean";
      defaultValue?: boolean;
    }
  | {
      name: string;
      labelKey: string;
      kind: "symbol";
      placeholder?: string;
    }
  | {
      name: string;
      labelKey: string;
      kind: "asset-display";
      placeholder?: string;
    }
  | {
      name: string;
      labelKey: string;
      kind: "json";
      placeholder?: string;
      defaultValue?: string;
    }
  | {
      name: string;
      labelKey: string;
      kind: "promotion-thresholds";
      descriptionKey?: string;
    };

export type ConfigResourceDefinition = {
  key: string;
  labelKey: string;
  labelSingularKey: string;
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
    labelKey: "configuration.resources.symbols",
    labelSingularKey: "configuration.resources_singular.symbols",
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
      { name: "code", labelKey: "configuration.fields.symbols.code", kind: "symbol", placeholder: "BTCUSDT" },
      { name: "baseAsset", labelKey: "configuration.fields.symbols.baseAsset", kind: "asset-display", placeholder: "Auto-filled from pair" },
      {
        name: "destinationAsset",
        labelKey: "configuration.fields.symbols.destinationAsset",
        kind: "asset-display",
        placeholder: "Auto-filled from pair",
      },
      { name: "active", labelKey: "configuration.fields.symbols.active", kind: "boolean" },
    ],
  },
  timeframes: {
    key: "timeframes",
    labelKey: "configuration.resources.timeframes",
    labelSingularKey: "configuration.resources_singular.timeframes",
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
      { name: "code", labelKey: "configuration.fields.timeframes.code", kind: "text", placeholder: "1m" },
      { name: "longerTimeframeCode", labelKey: "configuration.fields.timeframes.longerTimeframeCode", kind: "text" },
      {
        name: "longerTimeframeMultiplier",
        labelKey: "configuration.fields.timeframes.longerTimeframeMultiplier",
        kind: "number",
      },
      { name: "periodMs", labelKey: "configuration.fields.timeframes.periodMs", kind: "number" },
      { name: "active", labelKey: "configuration.fields.timeframes.active", kind: "boolean" },
    ],
  },
  strategies: {
    key: "strategies",
    labelKey: "configuration.resources.strategies",
    labelSingularKey: "configuration.resources_singular.strategies",
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
      { name: "name", labelKey: "configuration.fields.strategies.name", kind: "text" },
      { name: "description", labelKey: "configuration.fields.strategies.description", kind: "textarea", rows: 2 },
      { name: "activated", labelKey: "configuration.fields.strategies.activated", kind: "boolean" },
      {
        name: "parameters.kind",
        labelKey: "configuration.fields.strategies.kind",
        kind: "text",
        placeholder: "strategy1",
      },
      {
        name: "parameters.promotionThresholds",
        labelKey: "configuration.fields.strategies.promotionThresholds",
        kind: "promotion-thresholds",
        descriptionKey: "configuration.fields.strategies.promotionThresholdsDescription",
      },
    ],
  },
  "risk-profiles": {
    key: "risk-profiles",
    labelKey: "configuration.resources.risk-profiles",
    labelSingularKey: "configuration.resources_singular.risk-profiles",
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
      { name: "name", labelKey: "configuration.fields.risk-profiles.name", kind: "text" },
      { name: "description", labelKey: "configuration.fields.risk-profiles.description", kind: "textarea", rows: 2 },
      { name: "maximumStopLoss", labelKey: "configuration.fields.risk-profiles.maximumStopLoss", kind: "number" },
      { name: "minimumStopLoss", labelKey: "configuration.fields.risk-profiles.minimumStopLoss", kind: "number" },
      { name: "swingGap", labelKey: "configuration.fields.risk-profiles.swingGap", kind: "number" },
      { name: "rrr", labelKey: "configuration.fields.risk-profiles.rrr", kind: "number" },
      { name: "enabled", labelKey: "configuration.fields.risk-profiles.enabled", kind: "boolean" },
    ],
  },
  "analysis-settings": {
    key: "analysis-settings",
    labelKey: "configuration.resources.analysis-settings",
    labelSingularKey: "configuration.resources_singular.analysis-settings",
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
      { name: "name", labelKey: "configuration.fields.analysis-settings.name", kind: "text" },
      { name: "strategyName", labelKey: "configuration.fields.analysis-settings.strategyName", kind: "text" },
      {
        name: "technicalAnalysisSettings",
        labelKey: "configuration.fields.analysis-settings.technicalAnalysisSettings",
        kind: "json",
        placeholder: '{\n  "fastPeriod": 9,\n  "slowPeriod": 21\n}',
      },
      { name: "enabled", labelKey: "configuration.fields.analysis-settings.enabled", kind: "boolean" },
    ],
  },
  "execution-settings": {
    key: "execution-settings",
    labelKey: "configuration.resources.execution-settings",
    labelSingularKey: "configuration.resources_singular.execution-settings",
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
      { name: "name", labelKey: "configuration.fields.execution-settings.name", kind: "text" },
      { name: "enabled", labelKey: "configuration.fields.execution-settings.enabled", kind: "boolean" },
      {
        name: "mode",
        labelKey: "configuration.fields.execution-settings.mode",
        kind: "select",
        options: [
          { value: "paper", labelKey: "configuration.fields.execution-settings.modeOptions.paper" },
          { value: "live", labelKey: "configuration.fields.execution-settings.modeOptions.live" },
        ],
      },
      { name: "autoPromote", labelKey: "configuration.fields.execution-settings.autoPromote", kind: "boolean" },
      { name: "maxPromotions", labelKey: "configuration.fields.execution-settings.maxPromotions", kind: "number" },
      {
        name: "replaceOpenPositionPolicy",
        labelKey: "configuration.fields.execution-settings.replaceOpenPositionPolicy",
        kind: "select",
        options: [
          { value: "keep", labelKey: "configuration.fields.execution-settings.policyOptions.keep" },
          { value: "flatten", labelKey: "configuration.fields.execution-settings.policyOptions.flatten" },
        ],
      },
    ],
  },
};

export const configResourceKeys = Object.keys(configResources);

export const getResource = (key: string): ConfigResourceDefinition | undefined =>
  configResources[key];
