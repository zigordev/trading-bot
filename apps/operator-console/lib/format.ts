const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const usdCompactFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const countFormatter = new Intl.NumberFormat("en-US");

export function formatUsd(
  value: number | null | undefined,
  options: { compact?: boolean; signed?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const formatter = options.compact ? usdCompactFormatter : usdFormatter;
  const formatted = formatter.format(value);
  if (options.signed && value > 0) return `+${formatted}`;
  return formatted;
}

export function formatPrice(
  value: number | null | undefined,
  options: { maxFractionDigits?: number } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const digits =
    options.maxFractionDigits ??
    (abs === 0 ? 2 : abs < 1 ? 6 : abs < 100 ? 4 : 2);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPercent(
  value: number | null | undefined,
  options: { digits?: number; signed?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const digits = options.digits ?? 2;
  const formatted = `${value.toFixed(digits)}%`;
  if (options.signed && value > 0) return `+${formatted}`;
  return formatted;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return countFormatter.format(value);
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds - minutes * 60);
  if (minutes < 60) {
    return remSeconds === 0 ? `${minutes}m` : `${minutes}m ${remSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes - hours * 60;
  return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
}

type TimestampStyle = "relative" | "compact" | "full";

const compactFormatter = new Intl.DateTimeFormat("en-US", {
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const fullFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatTimestamp(
  input: string | number | Date | null | undefined,
  options: { style?: TimestampStyle; now?: Date } = {},
): string {
  if (input === null || input === undefined || input === "") return "—";
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "—";

  const style = options.style ?? "compact";
  if (style === "full") return fullFormatter.format(date);
  if (style === "compact") return compactFormatter.format(date);

  const now = options.now ?? new Date();
  const diffMs = now.getTime() - date.getTime();
  const absMs = Math.abs(diffMs);
  const sign = diffMs >= 0 ? "" : "in ";
  const suffix = diffMs >= 0 ? " ago" : "";

  if (absMs < 45_000) return "just now";
  const minutes = Math.round(absMs / 60_000);
  if (minutes < 60) return `${sign}${minutes}m${suffix}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${sign}${hours}h${suffix}`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${sign}${days}d${suffix}`;
  return compactFormatter.format(date);
}

export function truncateMiddle(
  value: string | null | undefined,
  head = 6,
  tail = 4,
): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
