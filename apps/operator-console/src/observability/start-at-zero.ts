import type { Counter, Histogram, LabelValues } from 'prom-client';

export function startAtZero<T extends string>(
  metric: Counter<T> | Histogram<T>,
  labelSets: readonly LabelValues<T>[]
): void {
  for (const labels of labelSets) {
    if ('zero' in metric) metric.zero(labels);
    else metric.inc(labels, 0);
  }
}
