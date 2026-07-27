"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { configResources } from "@/lib/configuration/schemas";

export default function ConfigurationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="lg:sticky lg:top-[72px] lg:self-start">
        <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">
          Resources
        </p>
        <ul className="flex flex-col gap-1">
          {Object.values(configResources).map((resource) => {
            const href = `/configuration/${resource.key}`;
            const active =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={resource.key}>
                <Link
                  href={href}
                  className={cn(
                    "block rounded-[var(--radius-md)] px-3 py-2 text-[13px] transition-colors",
                    active
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
                  )}
                >
                  {resource.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
