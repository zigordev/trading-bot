import type { BacktestJob, DataReadinessItem, RecentBacktestRun } from '@/lib/api';

export type RowStatus = 'ready' | 'partial' | 'missing' | 'error';

export interface ProgressTotals {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  progressPercent: number;
}

export interface BacktestRow {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  timeframeCode: string;
  strategyName: string;
  readiness: DataReadinessItem | null;
  status: RowStatus;
  klineCoverage: number | null;
  klineRowCount: number | null;
  klineWorstDimension: { code: string; coverage: number } | null;
  tradesCoverage: number | null;
  tradesRowCount: number | null;
  progress: ProgressTotals;
  jobs: BacktestJob[];
  latestRun: RecentBacktestRun | null;
  scoreHistory: number[];
}
