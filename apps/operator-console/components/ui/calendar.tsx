"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";

import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 text-[13px]", className)}
      classNames={{
        months: cn(defaults.months, "flex flex-col sm:flex-row gap-4"),
        month: cn(defaults.month, "flex flex-col gap-3"),
        month_caption: cn(
          defaults.month_caption,
          "flex h-9 items-center justify-center px-9",
        ),
        caption_label: cn(
          defaults.caption_label,
          "text-[13px] font-medium",
        ),
        nav: cn(
          defaults.nav,
          "absolute inset-x-0 top-0 flex items-center justify-between px-1",
        ),
        button_previous: cn(
          defaults.button_previous,
          "inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
        ),
        button_next: cn(
          defaults.button_next,
          "inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
        ),
        weekdays: cn(defaults.weekdays, "flex"),
        weekday: cn(
          defaults.weekday,
          "w-9 text-center text-[11px] font-normal uppercase tracking-wide text-[var(--color-fg-subtle)]",
        ),
        week: cn(defaults.week, "flex w-full mt-1"),
        day: cn(
          defaults.day,
          "size-9 p-0 text-center align-middle text-[13px]",
        ),
        day_button: cn(
          defaults.day_button,
          "inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-2)]",
        ),
        selected: cn(
          defaults.selected,
          "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] hover:text-white",
        ),
        today: cn(
          defaults.today,
          "font-semibold text-[var(--color-accent)]",
        ),
        outside: cn(
          defaults.outside,
          "text-[var(--color-fg-subtle)] opacity-50",
        ),
        disabled: cn(defaults.disabled, "opacity-40"),
        range_start: cn(defaults.range_start, "rounded-l-[var(--radius-sm)]"),
        range_middle: cn(
          defaults.range_middle,
          "bg-[var(--color-accent-bg)] text-[var(--color-fg)]",
        ),
        range_end: cn(defaults.range_end, "rounded-r-[var(--radius-sm)]"),
        hidden: cn(defaults.hidden, "invisible"),
        ...classNames,
      }}
      components={{
        Chevron: (chevronProps) => {
          if (chevronProps.orientation === "left") {
            return <ChevronLeft className="size-4" />;
          }
          return <ChevronRight className="size-4" />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
