import { randomUUID } from "node:crypto";

import type { Pool, QueryResultRow } from "pg";

import {
  type ConfigChangeOperation,
  type ConfigChangeEventPublisher,
} from "../infrastructure/config-change-events.js";

export type SymbolInput = {
  code: string;
  active: boolean;
  baseAsset: string;
  destinationAsset: string;
  originAssetNeededFunds?: number;
  destinationAssetNeededFunds?: number;
};

export type SymbolRecord = SymbolInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type TimeframeInput = {
  code: string;
  longerTimeframeCode: string;
  longerTimeframeMultiplier: number;
  periodMs: number;
  active: boolean;
};

export type TimeframeRecord = TimeframeInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type StrategyInput = {
  name: string;
  description: string;
  activated: boolean;
  parameters?: Record<string, unknown>;
};

export type StrategyRecord = StrategyInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type RiskProfileInput = {
  name: string;
  description: string;
  maximumStopLoss: number;
  minimumStopLoss: number;
  swingGap: number;
  rrr: number;
  enabled: boolean;
};

export type RiskProfileRecord = RiskProfileInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type TradingDefaultsInput = {
  name: string;
  description: string;
  defaultPositionNotionalUsd: number;
  enabled: boolean;
};

export type TradingDefaultsRecord = TradingDefaultsInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type AnalysisSettingsInput = {
  symbolCode: string;
  timeframeCode: string;
  strategyName: string;
  riskProfileName: string;
  tradingDefaultsName: string;
  technicalAnalysisSettings: Record<string, unknown>;
  enabled: boolean;
};

export type AnalysisSettingsRecord = Omit<
  AnalysisSettingsInput,
  "tradingDefaultsName"
> & {
  tradingDefaultsName: string | null;
} & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedAnalysisSettingsRecord = {
  id: string;
  symbolCode: string;
  timeframeCode: string;
  strategyName: string;
  riskProfileName: string;
  tradingDefaultsName: string;
  technicalAnalysisSettings: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  symbol: SymbolRecord;
  timeframe: TimeframeRecord;
  strategy: StrategyRecord;
  riskProfile: RiskProfileRecord;
  tradingDefaults: TradingDefaultsRecord;
};

type CrudStore<TInput, TRecord> = {
  list(): Promise<TRecord[]>;
  getById(id: string): Promise<TRecord | null>;
  create(input: TInput): Promise<TRecord>;
  update(id: string, input: TInput): Promise<TRecord | null>;
  delete(id: string): Promise<boolean>;
};

type ResourceDefinition<TInput, TRecord> = {
  tableName: string;
  resourceType: string;
  createTableSql: string;
  listOrderBy: string;
  selectColumns: string[];
  insertColumns: string[];
  uniqueFieldName: string;
  uniqueFieldValue: (input: TInput) => string;
  toInsertValues: (input: TInput) => unknown[];
  toRecord: (row: QueryResultRow) => TRecord;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toIsoString = (value: unknown): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(String(value)).toISOString();
};

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (isObject(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  }

  return {};
};

const toPositiveInteger = (value: unknown): number => {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const deriveAssetsFromSymbolCode = (
  code: string,
): { baseAsset: string; destinationAsset: string } | null => {
  const normalized = code.trim().toUpperCase();
  const knownQuoteAssets = [
    "USDT",
    "FDUSD",
    "USDC",
    "BUSD",
    "TUSD",
    "DAI",
    "BTC",
    "ETH",
    "BNB",
    "EUR",
    "GBP",
    "AUD",
    "BRL",
    "TRY",
  ];

  for (const quoteAsset of knownQuoteAssets) {
    if (normalized.endsWith(quoteAsset) && normalized.length > quoteAsset.length) {
      return {
        baseAsset: normalized.slice(0, -quoteAsset.length),
        destinationAsset: quoteAsset,
      };
    }
  }

  return null;
};

const deriveTimeframePeriodMs = (code: string): number | null => {
  const match = code.trim().match(/^(\d+)([smhdw])$/i);

  if (!match) {
    return null;
  }

  const magnitude = Number(match[1]);

  if (!Number.isInteger(magnitude) || magnitude <= 0) {
    return null;
  }

  const unitMultiplier = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  } as const;

  return magnitude * unitMultiplier[match[2].toLowerCase() as keyof typeof unitMultiplier];
};

const mapSymbolRow = (row: QueryResultRow): SymbolRecord => ({
  id: String(row.id),
  code: String(row.code),
  active: Boolean(row.active),
  baseAsset: String(row.base_asset),
  destinationAsset: String(row.destination_asset),
  originAssetNeededFunds:
    row.origin_asset_needed_funds === null
      ? undefined
      : Number(row.origin_asset_needed_funds),
  destinationAssetNeededFunds:
    row.destination_asset_needed_funds === null
      ? undefined
      : Number(row.destination_asset_needed_funds),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

const mapTimeframeRow = (row: QueryResultRow): TimeframeRecord => ({
  id: String(row.id),
  code: String(row.code),
  longerTimeframeCode: String(row.longer_timeframe_code),
  longerTimeframeMultiplier: Number(row.longer_timeframe_multiplier),
  periodMs: Number(row.period_ms),
  active: Boolean(row.active),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

const mapStrategyRow = (row: QueryResultRow): StrategyRecord => ({
  id: String(row.id),
  name: String(row.name),
  description: String(row.description),
  activated: Boolean(row.activated),
  parameters: parseJsonObject(row.parameters),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

const mapRiskProfileRow = (row: QueryResultRow): RiskProfileRecord => ({
  id: String(row.id),
  name: String(row.name),
  description: String(row.description),
  maximumStopLoss: Number(row.maximum_stop_loss),
  minimumStopLoss: Number(row.minimum_stop_loss),
  swingGap: Number(row.swing_gap),
  rrr: Number(row.rrr),
  enabled: Boolean(row.enabled),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

const mapTradingDefaultsRow = (row: QueryResultRow): TradingDefaultsRecord => ({
  id: String(row.id),
  name: String(row.name),
  description: String(row.description),
  defaultPositionNotionalUsd: Number(row.default_position_notional_usd),
  enabled: Boolean(row.enabled),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

const mapAnalysisSettingsRow = (row: QueryResultRow): AnalysisSettingsRecord => ({
  id: String(row.id),
  symbolCode: String(row.symbol_code),
  timeframeCode: String(row.timeframe_code),
  strategyName: String(row.strategy_name),
  riskProfileName: String(row.risk_profile_name),
  tradingDefaultsName:
    row.trading_defaults_name === null ? null : String(row.trading_defaults_name),
  technicalAnalysisSettings: parseJsonObject(row.technical_analysis_settings),
  enabled: Boolean(row.enabled),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

const mapResolvedAnalysisSettingsRow = (
  row: QueryResultRow,
): ResolvedAnalysisSettingsRecord => ({
  id: String(row.analysis_id),
  symbolCode: String(row.analysis_symbol_code),
  timeframeCode: String(row.analysis_timeframe_code),
  strategyName: String(row.analysis_strategy_name),
  riskProfileName: String(row.analysis_risk_profile_name),
  tradingDefaultsName: String(row.analysis_trading_defaults_name),
  technicalAnalysisSettings: parseJsonObject(
    row.analysis_technical_analysis_settings,
  ),
  enabled: Boolean(row.analysis_enabled),
  createdAt: toIsoString(row.analysis_created_at),
  updatedAt: toIsoString(row.analysis_updated_at),
  symbol: mapSymbolRow({
    id: row.symbol_id,
    code: row.symbol_entity_code,
    active: row.symbol_active,
    origin_asset_needed_funds: row.symbol_origin_asset_needed_funds,
    destination_asset_needed_funds: row.symbol_destination_asset_needed_funds,
    created_at: row.symbol_created_at,
    updated_at: row.symbol_updated_at,
  } as QueryResultRow),
  timeframe: mapTimeframeRow({
    id: row.timeframe_id,
    code: row.timeframe_entity_code,
    longer_timeframe_code: row.timeframe_longer_timeframe_code,
    longer_timeframe_multiplier: row.timeframe_longer_timeframe_multiplier,
    period_ms: row.timeframe_period_ms,
    active: row.timeframe_active,
    created_at: row.timeframe_created_at,
    updated_at: row.timeframe_updated_at,
  } as QueryResultRow),
  strategy: mapStrategyRow({
    id: row.strategy_id,
    name: row.strategy_entity_name,
    description: row.strategy_description,
    activated: row.strategy_activated,
    parameters: row.strategy_parameters,
    created_at: row.strategy_created_at,
    updated_at: row.strategy_updated_at,
  } as QueryResultRow),
  riskProfile: mapRiskProfileRow({
    id: row.risk_profile_id,
    name: row.risk_profile_entity_name,
    description: row.risk_profile_description,
    maximum_stop_loss: row.risk_profile_maximum_stop_loss,
    minimum_stop_loss: row.risk_profile_minimum_stop_loss,
    swing_gap: row.risk_profile_swing_gap,
    rrr: row.risk_profile_rrr,
    enabled: row.risk_profile_enabled,
    created_at: row.risk_profile_created_at,
    updated_at: row.risk_profile_updated_at,
  } as QueryResultRow),
  tradingDefaults: mapTradingDefaultsRow({
    id: row.trading_defaults_id,
    name: row.trading_defaults_entity_name,
    description: row.trading_defaults_description,
    default_position_notional_usd:
      row.trading_defaults_default_position_notional_usd,
    enabled: row.trading_defaults_enabled,
    created_at: row.trading_defaults_created_at,
    updated_at: row.trading_defaults_updated_at,
  } as QueryResultRow),
});

class PostgresCrudStore<TInput, TRecord> implements CrudStore<TInput, TRecord> {
  readonly #pool: Pool;
  readonly #definition: ResourceDefinition<TInput, TRecord>;
  readonly #eventPublisher: ConfigChangeEventPublisher;

  constructor(
    pool: Pool,
    definition: ResourceDefinition<TInput, TRecord>,
    eventPublisher: ConfigChangeEventPublisher,
  ) {
    this.#pool = pool;
    this.#definition = definition;
    this.#eventPublisher = eventPublisher;
  }

  async list(): Promise<TRecord[]> {
    const result = await this.#pool.query(
      `SELECT ${this.#definition.selectColumns.join(", ")}
         FROM ${this.#definition.tableName}
        ORDER BY ${this.#definition.listOrderBy}`,
    );

    return result.rows.map((row) => this.#definition.toRecord(row));
  }

  async getById(id: string): Promise<TRecord | null> {
    const result = await this.#pool.query(
      `SELECT ${this.#definition.selectColumns.join(", ")}
         FROM ${this.#definition.tableName}
        WHERE id = $1`,
      [id],
    );

    return result.rowCount === 0 ? null : this.#definition.toRecord(result.rows[0]);
  }

  async create(input: TInput): Promise<TRecord> {
    const client = await this.#pool.connect();
    const id = randomUUID();
    const timestamp = new Date();
    let record: TRecord | null = null;
    const columns = [
      "id",
      ...this.#definition.insertColumns,
      "created_at",
      "updated_at",
    ];
    const params = [
      id,
      ...this.#definition.toInsertValues(input),
      timestamp,
      timestamp,
    ];
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO ${this.#definition.tableName} (${columns.join(", ")})
         VALUES (${placeholders})
         RETURNING ${this.#definition.selectColumns.join(", ")}`,
        params,
      );
      record = this.#definition.toRecord(result.rows[0]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await this.#publishConfigChangeEvent("created", record);
    if (record === null) {
      throw new Error(
        `Config resource ${this.#definition.resourceType} was not created successfully`,
      );
    }
    return record;
  }

  async update(id: string, input: TInput): Promise<TRecord | null> {
    const client = await this.#pool.connect();
    const timestamp = new Date();
    let record: TRecord | null = null;
    const assignments = this.#definition.insertColumns.map(
      (column, index) => `${column} = $${index + 1}`,
    );
    const params = [
      ...this.#definition.toInsertValues(input),
      timestamp,
      id,
    ];

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE ${this.#definition.tableName}
            SET ${assignments.join(", ")}, updated_at = $${params.length - 1}
          WHERE id = $${params.length}
        RETURNING ${this.#definition.selectColumns.join(", ")}`,
        params,
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      record = this.#definition.toRecord(result.rows[0]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await this.#publishConfigChangeEvent("updated", record);
    return record;
  }

  async delete(id: string): Promise<boolean> {
    const client = await this.#pool.connect();
    let record: TRecord | null = null;

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `DELETE FROM ${this.#definition.tableName}
          WHERE id = $1
      RETURNING ${this.#definition.selectColumns.join(", ")}`,
        [id],
      );

      if ((result.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return false;
      }

      record = this.#definition.toRecord(result.rows[0]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await this.#publishConfigChangeEvent("deleted", record);
    return true;
  }

  get uniqueFieldName(): string {
    return this.#definition.uniqueFieldName;
  }

  getUniqueFieldValue(input: TInput): string {
    return this.#definition.uniqueFieldValue(input);
  }

  async #publishConfigChangeEvent(
    operation: ConfigChangeOperation,
    record: TRecord | null,
  ): Promise<void> {
    const resourceId =
      typeof record === "object" &&
      record !== null &&
      "id" in record &&
      typeof record.id === "string"
        ? record.id
        : "";

    if (!resourceId) {
      throw new Error(
        `Config resource ${this.#definition.resourceType} is missing an id for event publication`,
      );
    }

    await this.#eventPublisher.publish({
      resourceType: this.#definition.resourceType,
      operation,
      resourceId,
      data: record,
    });
  }
}

const symbolDefinition: ResourceDefinition<SymbolInput, SymbolRecord> = {
  tableName: "symbols",
  resourceType: "symbols",
  createTableSql: `
    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      base_asset TEXT NOT NULL,
      destination_asset TEXT NOT NULL,
      origin_asset_needed_funds DOUBLE PRECISION,
      destination_asset_needed_funds DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT symbols_origin_asset_needed_funds_nonnegative
        CHECK (origin_asset_needed_funds IS NULL OR origin_asset_needed_funds >= 0),
      CONSTRAINT symbols_destination_asset_needed_funds_nonnegative
        CHECK (
          destination_asset_needed_funds IS NULL
          OR destination_asset_needed_funds >= 0
        )
    );
  `,
  listOrderBy: "code ASC",
  selectColumns: [
    "id",
    "code",
    "active",
    "base_asset",
    "destination_asset",
    "origin_asset_needed_funds",
    "destination_asset_needed_funds",
    "created_at",
    "updated_at",
  ],
  insertColumns: [
    "code",
    "active",
    "base_asset",
    "destination_asset",
    "origin_asset_needed_funds",
    "destination_asset_needed_funds",
  ],
  uniqueFieldName: "code",
  uniqueFieldValue: (input) => input.code,
  toInsertValues: (input) => [
    input.code,
    input.active,
    input.baseAsset,
    input.destinationAsset,
    input.originAssetNeededFunds ?? null,
    input.destinationAssetNeededFunds ?? null,
  ],
  toRecord: mapSymbolRow,
};

const timeframeDefinition: ResourceDefinition<TimeframeInput, TimeframeRecord> = {
  tableName: "timeframes",
  resourceType: "timeframes",
  createTableSql: `
    CREATE TABLE IF NOT EXISTS timeframes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      longer_timeframe_code TEXT NOT NULL,
      longer_timeframe_multiplier INTEGER NOT NULL,
      period_ms INTEGER NOT NULL,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT timeframes_longer_timeframe_multiplier_positive
        CHECK (longer_timeframe_multiplier > 0),
      CONSTRAINT timeframes_period_ms_positive
        CHECK (period_ms > 0)
    );
  `,
  listOrderBy: "code ASC",
  selectColumns: [
    "id",
    "code",
    "longer_timeframe_code",
    "longer_timeframe_multiplier",
    "period_ms",
    "active",
    "created_at",
    "updated_at",
  ],
  insertColumns: [
    "code",
    "longer_timeframe_code",
    "longer_timeframe_multiplier",
    "period_ms",
    "active",
  ],
  uniqueFieldName: "code",
  uniqueFieldValue: (input) => input.code,
  toInsertValues: (input) => [
    input.code,
    input.longerTimeframeCode,
    input.longerTimeframeMultiplier,
    input.periodMs,
    input.active,
  ],
  toRecord: mapTimeframeRow,
};

const strategyDefinition: ResourceDefinition<StrategyInput, StrategyRecord> = {
  tableName: "strategies",
  resourceType: "strategies",
  createTableSql: `
    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      activated BOOLEAN NOT NULL DEFAULT FALSE,
      parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `,
  listOrderBy: "name ASC",
  selectColumns: [
    "id",
    "name",
    "description",
    "activated",
    "parameters",
    "created_at",
    "updated_at",
  ],
  insertColumns: ["name", "description", "activated", "parameters"],
  uniqueFieldName: "name",
  uniqueFieldValue: (input) => input.name,
  toInsertValues: (input) => [
    input.name,
    input.description,
    input.activated,
    JSON.stringify(input.parameters ?? {}),
  ],
  toRecord: mapStrategyRow,
};

const riskProfileDefinition: ResourceDefinition<RiskProfileInput, RiskProfileRecord> =
  {
    tableName: "risk_profiles",
    resourceType: "risk_profiles",
    createTableSql: `
      CREATE TABLE IF NOT EXISTS risk_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        maximum_stop_loss DOUBLE PRECISION NOT NULL,
        minimum_stop_loss DOUBLE PRECISION NOT NULL,
        swing_gap DOUBLE PRECISION NOT NULL,
        rrr DOUBLE PRECISION NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT risk_profiles_stop_losses_positive
          CHECK (maximum_stop_loss > 0 AND minimum_stop_loss > 0),
        CONSTRAINT risk_profiles_stop_losses_ordered
          CHECK (maximum_stop_loss >= minimum_stop_loss),
        CONSTRAINT risk_profiles_swing_gap_nonnegative
          CHECK (swing_gap >= 0),
        CONSTRAINT risk_profiles_rrr_positive
          CHECK (rrr > 0)
      );
    `,
    listOrderBy: "name ASC",
    selectColumns: [
      "id",
      "name",
      "description",
      "maximum_stop_loss",
      "minimum_stop_loss",
      "swing_gap",
      "rrr",
      "enabled",
      "created_at",
      "updated_at",
    ],
    insertColumns: [
      "name",
      "description",
      "maximum_stop_loss",
      "minimum_stop_loss",
      "swing_gap",
      "rrr",
      "enabled",
    ],
    uniqueFieldName: "name",
    uniqueFieldValue: (input) => input.name,
    toInsertValues: (input) => [
      input.name,
      input.description,
      input.maximumStopLoss,
      input.minimumStopLoss,
      input.swingGap,
      input.rrr,
      input.enabled,
    ],
    toRecord: mapRiskProfileRow,
  };

const tradingDefaultsDefinition: ResourceDefinition<
  TradingDefaultsInput,
  TradingDefaultsRecord
> = {
  tableName: "trading_defaults",
  resourceType: "trading_defaults",
  createTableSql: `
    CREATE TABLE IF NOT EXISTS trading_defaults (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      default_position_notional_usd DOUBLE PRECISION NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT trading_defaults_default_position_notional_positive
        CHECK (default_position_notional_usd > 0)
    );
  `,
  listOrderBy: "name ASC",
  selectColumns: [
    "id",
    "name",
    "description",
    "default_position_notional_usd",
    "enabled",
    "created_at",
    "updated_at",
  ],
  insertColumns: [
    "name",
    "description",
    "default_position_notional_usd",
    "enabled",
  ],
  uniqueFieldName: "name",
  uniqueFieldValue: (input) => input.name,
  toInsertValues: (input) => [
    input.name,
    input.description,
    input.defaultPositionNotionalUsd,
    input.enabled,
  ],
  toRecord: mapTradingDefaultsRow,
};

const analysisSettingsDefinition: ResourceDefinition<AnalysisSettingsInput, AnalysisSettingsRecord> = {
  tableName: "analysis_settings",
  resourceType: "analysis_settings",
  createTableSql: `
    CREATE TABLE IF NOT EXISTS analysis_settings (
      id TEXT PRIMARY KEY,
      symbol_code TEXT NOT NULL
        REFERENCES symbols(code)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
      timeframe_code TEXT NOT NULL
        REFERENCES timeframes(code)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
      strategy_name TEXT NOT NULL
        REFERENCES strategies(name)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
      risk_profile_name TEXT NOT NULL
        REFERENCES risk_profiles(name)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
      trading_defaults_name TEXT NOT NULL
        REFERENCES trading_defaults(name)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
      technical_analysis_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT analysis_settings_binding_unique
        UNIQUE (
          symbol_code,
          timeframe_code,
          strategy_name,
          risk_profile_name,
          trading_defaults_name,
          technical_analysis_settings
        )
    );
  `,
  listOrderBy: "symbol_code ASC, timeframe_code ASC, strategy_name ASC",
  selectColumns: [
    "id",
    "symbol_code",
    "timeframe_code",
    "strategy_name",
    "risk_profile_name",
    "trading_defaults_name",
    "technical_analysis_settings",
    "enabled",
    "created_at",
    "updated_at",
  ],
  insertColumns: [
    "symbol_code",
    "timeframe_code",
    "strategy_name",
    "risk_profile_name",
    "trading_defaults_name",
    "technical_analysis_settings",
    "enabled",
  ],
  uniqueFieldName:
    "symbolCode/timeframeCode/strategyName/riskProfileName/tradingDefaultsName/technicalAnalysisSettings",
  uniqueFieldValue: (input) =>
    `${input.symbolCode}/${input.timeframeCode}/${input.strategyName}/${input.riskProfileName}/${input.tradingDefaultsName}/${JSON.stringify(input.technicalAnalysisSettings)}`,
  toInsertValues: (input) => [
    input.symbolCode,
    input.timeframeCode,
    input.strategyName,
    input.riskProfileName,
    input.tradingDefaultsName,
    JSON.stringify(input.technicalAnalysisSettings),
    input.enabled,
  ],
  toRecord: mapAnalysisSettingsRow,
};

const resourceDefinitions = [
  symbolDefinition,
  timeframeDefinition,
  strategyDefinition,
  riskProfileDefinition,
  tradingDefaultsDefinition,
  analysisSettingsDefinition,
] as const;

export const ensureControlPlaneSchema = async (pool: Pool): Promise<void> => {
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'pairs'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'symbols'
      ) THEN
        ALTER TABLE pairs RENAME TO symbols;
      END IF;
    END $$;
  `);

  await pool.query(symbolDefinition.createTableSql);
  await pool.query(timeframeDefinition.createTableSql);

  await pool.query(
    "ALTER TABLE symbols ADD COLUMN IF NOT EXISTS base_asset TEXT",
  );
  await pool.query(
    "ALTER TABLE symbols ADD COLUMN IF NOT EXISTS destination_asset TEXT",
  );

  const symbolsMissingAssets = await pool.query<{
    id: string;
    code: string;
  }>(
    `SELECT id, code
       FROM symbols
      WHERE base_asset IS NULL
         OR destination_asset IS NULL`,
  );

  for (const symbol of symbolsMissingAssets.rows) {
    const derivedAssets = deriveAssetsFromSymbolCode(symbol.code);

    if (!derivedAssets) {
      throw new Error(
        `Unable to derive base/destination assets for existing symbol code "${symbol.code}"`,
      );
    }

    await pool.query(
      `UPDATE symbols
          SET base_asset = COALESCE(base_asset, $1),
              destination_asset = COALESCE(destination_asset, $2)
        WHERE id = $3`,
      [derivedAssets.baseAsset, derivedAssets.destinationAsset, symbol.id],
    );
  }

  await pool.query("ALTER TABLE symbols ALTER COLUMN base_asset SET NOT NULL");
  await pool.query(
    "ALTER TABLE symbols ALTER COLUMN destination_asset SET NOT NULL",
  );

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'symbols' AND column_name = 'operable'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'symbols' AND column_name = 'active'
      ) THEN
        ALTER TABLE symbols RENAME COLUMN operable TO active;
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'timeframes' AND column_name = 'operable'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'timeframes' AND column_name = 'active'
      ) THEN
        ALTER TABLE timeframes RENAME COLUMN operable TO active;
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'analysis_settings' AND column_name = 'pair_code'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'analysis_settings' AND column_name = 'symbol_code'
      ) THEN
        ALTER TABLE analysis_settings RENAME COLUMN pair_code TO symbol_code;
      END IF;
    END $$;
  `);

  for (const definition of resourceDefinitions.slice(2)) {
    await pool.query(definition.createTableSql);
  }

  await pool.query("DROP TABLE IF EXISTS config_change_outbox");

  // Existing local DBs may already have timeframes without period_ms. Backfill from the
  // business code so timeframe period metadata lives with the timeframe itself.
  await pool.query("ALTER TABLE timeframes ADD COLUMN IF NOT EXISTS period_ms INTEGER");
  const timeframesMissingPeriod = await pool.query<{
    id: string;
    code: string;
  }>(
    `SELECT id, code
       FROM timeframes
      WHERE period_ms IS NULL`,
  );

  for (const timeframe of timeframesMissingPeriod.rows) {
    const derivedPeriodMs = deriveTimeframePeriodMs(timeframe.code);

    if (derivedPeriodMs === null) {
      throw new Error(
        `Unable to derive timeframe period for existing timeframe code "${timeframe.code}"`,
      );
    }

    await pool.query(
      `UPDATE timeframes
          SET period_ms = $1
        WHERE id = $2`,
      [derivedPeriodMs, timeframe.id],
    );
  }

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'timeframes_period_ms_positive'
      ) THEN
        ALTER TABLE timeframes
          ADD CONSTRAINT timeframes_period_ms_positive
          CHECK (period_ms > 0);
      END IF;
    END
    $$;
  `);
  await pool.query("ALTER TABLE timeframes ALTER COLUMN period_ms SET NOT NULL");

  // Existing local DBs may already have analysis_settings without trading_defaults_name.
  await pool.query(
    "ALTER TABLE analysis_settings ADD COLUMN IF NOT EXISTS trading_defaults_name TEXT",
  );
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'analysis_settings_trading_defaults_name_fkey'
      ) THEN
        ALTER TABLE analysis_settings
          ADD CONSTRAINT analysis_settings_trading_defaults_name_fkey
          FOREIGN KEY (trading_defaults_name)
          REFERENCES trading_defaults(name)
          ON UPDATE CASCADE
          ON DELETE RESTRICT;
      END IF;
    END
    $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'analysis_settings'
          AND column_name = 'trading_defaults_name'
          AND is_nullable = 'YES'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM analysis_settings
        WHERE trading_defaults_name IS NULL
      ) THEN
        ALTER TABLE analysis_settings
          ALTER COLUMN trading_defaults_name SET NOT NULL;
      END IF;
    END
    $$;
  `);

  await pool.query(
    "ALTER TABLE analysis_settings DROP CONSTRAINT IF EXISTS analysis_settings_binding_unique",
  );
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'analysis_settings_binding_unique'
          AND conrelid = 'analysis_settings'::regclass
      ) THEN
        ALTER TABLE analysis_settings
          ADD CONSTRAINT analysis_settings_binding_unique
          UNIQUE (
            symbol_code,
            timeframe_code,
            strategy_name,
            risk_profile_name,
            trading_defaults_name,
            technical_analysis_settings
          );
      END IF;
    END
    $$;
  `);

  // Cleanup from the earlier experimental secret-reference slice. Binance credentials
  // now come directly from OpenBao app config rather than through DB indirection.
  await pool.query(
    "ALTER TABLE trading_defaults DROP CONSTRAINT IF EXISTS trading_defaults_exchange_secret_reference_name_fkey",
  );
  await pool.query(
    "ALTER TABLE trading_defaults DROP COLUMN IF EXISTS exchange_secret_reference_name",
  );
  await pool.query("DROP TABLE IF EXISTS exchange_secret_references");
};

export const createConfigStores = (
  pool: Pool,
  eventPublisher: ConfigChangeEventPublisher,
) => ({
  symbols: new PostgresCrudStore(pool, symbolDefinition, eventPublisher),
  timeframes: new PostgresCrudStore(pool, timeframeDefinition, eventPublisher),
  strategies: new PostgresCrudStore(pool, strategyDefinition, eventPublisher),
  riskProfiles: new PostgresCrudStore(pool, riskProfileDefinition, eventPublisher),
  tradingDefaults: new PostgresCrudStore(pool, tradingDefaultsDefinition, eventPublisher),
  analysisSettings: new PostgresCrudStore(
    pool,
    analysisSettingsDefinition,
    eventPublisher,
  ),
});

export type ConfigStores = ReturnType<typeof createConfigStores>;

export type ConfigStore<TInput, TRecord> = CrudStore<TInput, TRecord> & {
  readonly uniqueFieldName: string;
  getUniqueFieldValue(input: TInput): string;
};

export const symbolBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    code: { type: "string", minLength: 1 },
    active: { type: "boolean" },
    baseAsset: { type: "string", minLength: 1 },
    destinationAsset: { type: "string", minLength: 1 },
    originAssetNeededFunds: { type: "number" },
    destinationAssetNeededFunds: { type: "number" },
  },
  required: ["code", "active", "baseAsset", "destinationAsset"],
} as const;

export const symbolRecordSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    code: { type: "string" },
    active: { type: "boolean" },
    baseAsset: { type: "string" },
    destinationAsset: { type: "string" },
    originAssetNeededFunds: { type: "number", nullable: true },
    destinationAssetNeededFunds: { type: "number", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "code",
    "active",
    "baseAsset",
    "destinationAsset",
    "createdAt",
    "updatedAt",
  ],
} as const;

export const timeframeBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    code: { type: "string", minLength: 1 },
    longerTimeframeCode: { type: "string", minLength: 1 },
    longerTimeframeMultiplier: { type: "integer", minimum: 1 },
    periodMs: { type: "integer", minimum: 1 },
    active: { type: "boolean" },
  },
  required: [
    "code",
    "longerTimeframeCode",
    "longerTimeframeMultiplier",
    "periodMs",
    "active",
  ],
} as const;

export const timeframeRecordSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    code: { type: "string" },
    longerTimeframeCode: { type: "string" },
    longerTimeframeMultiplier: { type: "integer" },
    periodMs: { type: "integer" },
    active: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "code",
    "longerTimeframeCode",
    "longerTimeframeMultiplier",
    "periodMs",
    "active",
    "createdAt",
    "updatedAt",
  ],
} as const;

export const strategyBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    activated: { type: "boolean" },
    parameters: {
      type: "object",
      additionalProperties: true,
    },
  },
  required: ["name", "description", "activated"],
} as const;

export const strategyRecordSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    activated: { type: "boolean" },
    parameters: {
      type: "object",
      additionalProperties: true,
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "name",
    "description",
    "activated",
    "parameters",
    "createdAt",
    "updatedAt",
  ],
} as const;

export const riskProfileBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    maximumStopLoss: { type: "number", exclusiveMinimum: 0 },
    minimumStopLoss: { type: "number", exclusiveMinimum: 0 },
    swingGap: { type: "number", minimum: 0 },
    rrr: { type: "number", exclusiveMinimum: 0 },
    enabled: { type: "boolean" },
  },
  required: [
    "name",
    "description",
    "maximumStopLoss",
    "minimumStopLoss",
    "swingGap",
    "rrr",
    "enabled",
  ],
} as const;

export const riskProfileRecordSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    maximumStopLoss: { type: "number" },
    minimumStopLoss: { type: "number" },
    swingGap: { type: "number" },
    rrr: { type: "number" },
    enabled: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "name",
    "description",
    "maximumStopLoss",
    "minimumStopLoss",
    "swingGap",
    "rrr",
    "enabled",
    "createdAt",
    "updatedAt",
  ],
} as const;

export const tradingDefaultsBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    defaultPositionNotionalUsd: { type: "number", exclusiveMinimum: 0 },
    enabled: { type: "boolean" },
  },
  required: [
    "name",
    "description",
    "defaultPositionNotionalUsd",
    "enabled",
  ],
} as const;

export const tradingDefaultsRecordSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    defaultPositionNotionalUsd: { type: "number" },
    enabled: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "name",
    "description",
    "defaultPositionNotionalUsd",
    "enabled",
    "createdAt",
    "updatedAt",
  ],
} as const;

export const analysisSettingsBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    symbolCode: { type: "string", minLength: 1 },
    timeframeCode: { type: "string", minLength: 1 },
    strategyName: { type: "string", minLength: 1 },
    riskProfileName: { type: "string", minLength: 1 },
    tradingDefaultsName: { type: "string", minLength: 1 },
    technicalAnalysisSettings: {
      type: "object",
      additionalProperties: true,
    },
    enabled: { type: "boolean" },
  },
  required: [
    "symbolCode",
    "timeframeCode",
    "strategyName",
    "riskProfileName",
    "tradingDefaultsName",
    "technicalAnalysisSettings",
    "enabled",
  ],
} as const;

export const analysisSettingsRecordSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    symbolCode: { type: "string" },
    timeframeCode: { type: "string" },
    strategyName: { type: "string" },
    riskProfileName: { type: "string" },
    tradingDefaultsName: { type: "string", nullable: true },
    technicalAnalysisSettings: {
      type: "object",
      additionalProperties: true,
    },
    enabled: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "symbolCode",
    "timeframeCode",
    "strategyName",
    "riskProfileName",
    "tradingDefaultsName",
    "technicalAnalysisSettings",
    "enabled",
    "createdAt",
    "updatedAt",
  ],
} as const;

export const resolvedAnalysisSettingsRecordSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    symbolCode: { type: "string" },
    timeframeCode: { type: "string" },
    strategyName: { type: "string" },
    riskProfileName: { type: "string" },
    tradingDefaultsName: { type: "string" },
    technicalAnalysisSettings: {
      type: "object",
      additionalProperties: true,
    },
    enabled: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    symbol: symbolRecordSchema,
    timeframe: timeframeRecordSchema,
    strategy: strategyRecordSchema,
    riskProfile: riskProfileRecordSchema,
    tradingDefaults: tradingDefaultsRecordSchema,
  },
  required: [
    "id",
    "symbolCode",
    "timeframeCode",
    "strategyName",
    "riskProfileName",
    "tradingDefaultsName",
    "technicalAnalysisSettings",
    "enabled",
    "createdAt",
    "updatedAt",
    "symbol",
    "timeframe",
    "strategy",
    "riskProfile",
    "tradingDefaults",
  ],
} as const;

export const listResolvedAnalysisSettings = async (
  pool: Pool,
): Promise<ResolvedAnalysisSettingsRecord[]> => {
  const result = await pool.query(`
    SELECT
      a.id AS analysis_id,
      a.symbol_code AS analysis_symbol_code,
      a.timeframe_code AS analysis_timeframe_code,
      a.strategy_name AS analysis_strategy_name,
      a.risk_profile_name AS analysis_risk_profile_name,
      a.trading_defaults_name AS analysis_trading_defaults_name,
      a.technical_analysis_settings AS analysis_technical_analysis_settings,
      a.enabled AS analysis_enabled,
      a.created_at AS analysis_created_at,
      a.updated_at AS analysis_updated_at,
      s2.id AS symbol_id,
      s2.code AS symbol_entity_code,
      s2.active AS symbol_active,
      s2.origin_asset_needed_funds AS symbol_origin_asset_needed_funds,
      s2.destination_asset_needed_funds AS symbol_destination_asset_needed_funds,
      s2.created_at AS symbol_created_at,
      s2.updated_at AS symbol_updated_at,
      t.id AS timeframe_id,
      t.code AS timeframe_entity_code,
      t.longer_timeframe_code AS timeframe_longer_timeframe_code,
      t.longer_timeframe_multiplier AS timeframe_longer_timeframe_multiplier,
      t.period_ms AS timeframe_period_ms,
      t.active AS timeframe_active,
      t.created_at AS timeframe_created_at,
      t.updated_at AS timeframe_updated_at,
      s.id AS strategy_id,
      s.name AS strategy_entity_name,
      s.description AS strategy_description,
      s.activated AS strategy_activated,
      s.parameters AS strategy_parameters,
      s.created_at AS strategy_created_at,
      s.updated_at AS strategy_updated_at,
      r.id AS risk_profile_id,
      r.name AS risk_profile_entity_name,
      r.description AS risk_profile_description,
      r.maximum_stop_loss AS risk_profile_maximum_stop_loss,
      r.minimum_stop_loss AS risk_profile_minimum_stop_loss,
      r.swing_gap AS risk_profile_swing_gap,
      r.rrr AS risk_profile_rrr,
      r.enabled AS risk_profile_enabled,
      r.created_at AS risk_profile_created_at,
      r.updated_at AS risk_profile_updated_at,
      td.id AS trading_defaults_id,
      td.name AS trading_defaults_entity_name,
      td.description AS trading_defaults_description,
      td.default_position_notional_usd
        AS trading_defaults_default_position_notional_usd,
      td.enabled AS trading_defaults_enabled,
      td.created_at AS trading_defaults_created_at,
      td.updated_at AS trading_defaults_updated_at
    FROM analysis_settings a
    INNER JOIN symbols s2 ON s2.code = a.symbol_code
    INNER JOIN timeframes t ON t.code = a.timeframe_code
    INNER JOIN strategies s ON s.name = a.strategy_name
    INNER JOIN risk_profiles r ON r.name = a.risk_profile_name
    INNER JOIN trading_defaults td ON td.name = a.trading_defaults_name
    WHERE a.enabled = TRUE
      AND s2.active = TRUE
      AND t.active = TRUE
      AND s.activated = TRUE
      AND r.enabled = TRUE
      AND td.enabled = TRUE
    ORDER BY a.symbol_code ASC, a.timeframe_code ASC, a.strategy_name ASC
  `);

  return result.rows.map((row) => mapResolvedAnalysisSettingsRow(row));
};
