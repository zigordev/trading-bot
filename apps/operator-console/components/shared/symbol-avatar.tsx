"use client";

import * as React from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";
import { splitSymbol } from "@/lib/backtesting/derive-rows";

const GENERIC_ICON_URL =
  "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/generic.png";

function iconUrl(asset: string | null | undefined): string {
  const code = asset?.trim().toLowerCase();
  if (!code) return GENERIC_ICON_URL;
  return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${code}.png`;
}

export function AssetIcon({
  asset,
  size,
  className,
}: {
  asset?: string | null;
  size: number;
  className?: string;
}) {
  const target = iconUrl(asset);
  const [src, setSrc] = React.useState(target);
  const [failed, setFailed] = React.useState(false);
  const fallback = (asset?.trim().slice(0, 3) || "?").toUpperCase();

  React.useEffect(() => {
    setSrc(target);
    setFailed(false);
  }, [target]);

  if (failed) {
    return (
      <span
        className={cn(
          "inline-flex select-none items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] font-semibold uppercase text-[var(--color-fg-muted)]",
          className,
        )}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(9, Math.round(size * 0.34)),
        }}
      >
        {fallback}
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={asset ?? "asset"}
      width={size}
      height={size}
      unoptimized
      className={cn("rounded-full bg-white", className)}
      onError={() => {
        if (src === GENERIC_ICON_URL) setFailed(true);
        else setSrc(GENERIC_ICON_URL);
      }}
    />
  );
}

interface SymbolAvatarProps {
  baseAsset?: string | null;
  quoteAsset?: string | null;
  size?: number;
  className?: string;
}

export function SymbolAvatar({
  baseAsset,
  quoteAsset,
  size = 28,
  className,
}: SymbolAvatarProps) {
  const quoteSize = Math.max(14, Math.round(size * 0.5));
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center", className)}
      style={{ width: size + Math.round(quoteSize * 0.4), height: size }}
    >
      <AssetIcon asset={baseAsset} size={size} />
      {quoteAsset && (
        <span
          className="absolute -bottom-0.5 right-0 inline-flex items-center justify-center rounded-full bg-white p-[1px] ring-1 ring-[var(--color-border)]"
          style={{ width: quoteSize + 2, height: quoteSize + 2 }}
        >
          <AssetIcon asset={quoteAsset} size={quoteSize} />
        </span>
      )}
    </span>
  );
}

interface PairLabelProps {
  code: string;
  size?: number;
  className?: string;
  textClassName?: string;
}

export function PairLabel({
  code,
  size = 22,
  className,
  textClassName,
}: PairLabelProps) {
  const { base, quote } = splitSymbol(code);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <SymbolAvatar baseAsset={base} quoteAsset={quote} size={size} />
      <span className={cn("font-medium text-[var(--color-fg)]", textClassName)}>
        {code}
      </span>
    </span>
  );
}

interface AssetLabelProps {
  asset: string;
  size?: number;
  className?: string;
  textClassName?: string;
}

export function AssetLabel({
  asset,
  size = 18,
  className,
  textClassName,
}: AssetLabelProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <AssetIcon asset={asset} size={size} />
      <span className={cn("text-[var(--color-fg)]", textClassName)}>{asset}</span>
    </span>
  );
}
