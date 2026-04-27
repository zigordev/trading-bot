"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}

export function CopyButton({
  value,
  label = "Copy",
  className,
  size = "sm",
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore — clipboard may be unavailable
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size === "sm" ? "icon-sm" : "icon"}
          onClick={handleCopy}
          aria-label={copied ? "Copied" : label}
          className={cn(
            "text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]",
            className,
          )}
        >
          {copied ? (
            <Check className="text-[var(--color-success)]" />
          ) : (
            <Copy />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  );
}
