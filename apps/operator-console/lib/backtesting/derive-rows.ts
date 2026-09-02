import type {
  BacktestJob,
  BacktestsSummaryResponse,
  DataReadinessItem,
  DataReadinessResponse,
  RecentBacktestRun,
} from '@/lib/api';

import type { BacktestRow, ProgressTotals, RowStatus } from './types';

export function splitSymbol(symbol: string): { base: string; quote: string } {
  const known = ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH'];
  const upper = symbol.toUpperCase();
  for (const quote of known) {
    if (upper.endsWith(quote)) {
      return { base: upper.slice(0, -quote.length), quote };
    }
  }
  return { base: upper.slice(0, -3), quote: upper.slice(-3) };
}

function rowKey(symbol: string, timeframeCode: string, strategyName: string): string {
  return `${symbol}::${timeframeCode}::${strategyName}`;
}

function emptyProgress(): ProgressTotals {
  return {
    total: 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    progressPercent: 0,
  };
}

function statusFromReadinessOrJobs(
  readiness: DataReadinessItem | null,
  jobs: BacktestJob[]
): RowStatus {
  if (jobs.some((j) => j.status === 'failed')) return 'error';
  if (readiness?.status) return readiness.status;
  if (jobs.length === 0) return 'missing';
  return 'partial';
}

function rollupProgress(jobs: BacktestJob[]): ProgressTotals {
  const totals = emptyProgress();
  totals.total = jobs.length;
  let progressSum = 0;
  for (const job of jobs) {
    if (job.status === 'queued') totals.queued += 1;
    else if (job.status === 'running') totals.running += 1;
    else if (job.status === 'completed') totals.completed += 1;
    else if (job.status === 'failed') totals.failed += 1;
    if (typeof job.progressPercent === 'number') {
      progressSum += job.progressPercent;
    } else if (job.status === 'completed') {
      progressSum += 100;
    }
  }
  totals.progressPercent =
    jobs.length === 0 ? 0 : Math.min(100, Math.round(progressSum / jobs.length));
  return totals;
}

function pickLatestRun(runs: RecentBacktestRun[]): RecentBacktestRun | null {
  if (runs.length === 0) return null;
  return [...runs].sort(
    (a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime()
  )[0];
}

function scoreHistoryFor(runs: RecentBacktestRun[]): number[] {
  return [...runs]
    .sort((a, b) => new Date(a.finishedAt).getTime() - new Date(b.finishedAt).getTime())
    .map((r) => r.score)
    .slice(-10);
}

interface DeriveInput {
  summary: BacktestsSummaryResponse | undefined;
  readiness: DataReadinessResponse | undefined;
}

export function deriveBacktestRows({ summary, readiness }: DeriveInput): BacktestRow[] {
  const rowMap = new Map<string, BacktestRow>();

  const ensureRow = (symbol: string, timeframeCode: string, strategyName: string): BacktestRow => {
    const key = rowKey(symbol, timeframeCode, strategyName);
    let row = rowMap.get(key);
    if (!row) {
      const { base, quote } = splitSymbol(symbol);
      row = {
        id: key,
        symbol,
        baseAsset: base,
        quoteAsset: quote,
        timeframeCode,
        strategyName,
        readiness: null,
        status: 'missing',
        klineCoverage: null,
        klineRowCount: null,
        klineWorstDimension: null,
        tradesCoverage: null,
        tradesRowCount: null,
        progress: emptyProgress(),
        jobs: [],
        latestRun: null,
        scoreHistory: [],
      };
      rowMap.set(key, row);
    }
    return row;
  };

  for (const item of readiness?.items ?? []) {
    const row = ensureRow(item.symbolCode, item.timeframeCode, item.strategyName);
    row.readiness = item;

    const klineCoverage = item.kline?.coveragePercent ?? null;
    const klineRows = item.kline?.rowCount ?? null;
    row.klineCoverage = klineCoverage;
    row.klineRowCount = klineRows;
    if (item.klineDimensions && item.klineDimensions.length > 0) {
      let worst: { code: string; coverage: number } | null = null;
      for (const dim of item.klineDimensions) {
        const coverage = dim.coveragePercent ?? 0;
        if (!worst || coverage < worst.coverage) {
          worst = { code: dim.timeframeCode ?? item.timeframeCode, coverage };
        }
      }
      row.klineWorstDimension = worst;
    }

    row.tradesCoverage = item.trades?.coveragePercent ?? null;
    row.tradesRowCount = item.trades?.rowCount ?? null;
  }

  const jobsBySymbolTfStrat = new Map<string, BacktestJob[]>();
  for (const job of summary?.jobs ?? []) {
    if (!job.symbolCode || !job.timeframeCode || !job.strategyName) continue;
    const key = rowKey(job.symbolCode, job.timeframeCode, job.strategyName);
    const list = jobsBySymbolTfStrat.get(key);
    if (list) list.push(job);
    else jobsBySymbolTfStrat.set(key, [job]);
  }

  for (const [key, jobs] of jobsBySymbolTfStrat) {
    const [symbol, timeframeCode, strategyName] = key.split('::');
    const row = ensureRow(symbol, timeframeCode, strategyName);
    row.jobs = jobs;
    row.progress = rollupProgress(jobs);
  }

  const recentBySymbolTfStrat = new Map<string, RecentBacktestRun[]>();
  for (const run of summary?.recentRuns ?? []) {
    const key = rowKey(run.symbol, run.timeframeCode, run.strategyName);
    const list = recentBySymbolTfStrat.get(key);
    if (list) list.push(run);
    else recentBySymbolTfStrat.set(key, [run]);
  }

  for (const run of summary?.latestRuns ?? []) {
    const key = rowKey(run.symbol, run.timeframeCode, run.strategyName);
    const row = ensureRow(run.symbol, run.timeframeCode, run.strategyName);
    if (!row.latestRun || new Date(run.finishedAt) > new Date(row.latestRun.finishedAt)) {
      row.latestRun = run;
    }
  }

  for (const [key, runs] of recentBySymbolTfStrat) {
    const [symbol, timeframeCode, strategyName] = key.split('::');
    const row = ensureRow(symbol, timeframeCode, strategyName);
    if (!row.latestRun) row.latestRun = pickLatestRun(runs);
    row.scoreHistory = scoreHistoryFor(runs);
  }

  for (const row of rowMap.values()) {
    row.status = statusFromReadinessOrJobs(row.readiness, row.jobs);
  }

  return Array.from(rowMap.values()).sort((a, b) => {
    if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
    if (a.timeframeCode !== b.timeframeCode) return a.timeframeCode.localeCompare(b.timeframeCode);
    return a.strategyName.localeCompare(b.strategyName);
  });
}
