import type { RuntimeAnalysis } from "./api";

const formatKey = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());

const formatValue = (value: unknown): string => {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatValue(entry)).join(", ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return "n/a";
};

const summarizeTechnicalSettings = (settings: Record<string, unknown>): string => {
  const entries = Object.entries(settings);
  if (entries.length === 0) {
    return "No parameters";
  }

  return entries
    .slice(0, 4)
    .map(([key, value]) => `${formatKey(key)} ${formatValue(value)}`)
    .join(" · ");
};

export const summarizeAnalysisDetail = (analysis: RuntimeAnalysis): string =>
  [analysis.strategyName, summarizeTechnicalSettings(analysis.technicalAnalysisSettings)]
    .filter(Boolean)
    .join(" · ");

export const buildAnalysisDetailMap = (analyses: RuntimeAnalysis[]): Map<string, string> =>
  new Map(analyses.map((analysis) => [analysis.id, summarizeAnalysisDetail(analysis)]));
