"use client";

import * as React from "react";
import { Columns3, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ColumnDescriptor {
  id: string;
  label: string;
  visible: boolean;
}

interface DataTableToolbarProps {
  search?: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
  };
  columns?: {
    items: ColumnDescriptor[];
    onToggle: (id: string, next: boolean) => void;
  };
  start?: React.ReactNode;
  end?: React.ReactNode;
  className?: string;
}

export function DataTableToolbar({
  search,
  columns,
  start,
  end,
  className,
}: DataTableToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        className,
      )}
    >
      {start}
      {search && (
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
          <Input
            placeholder={search.placeholder ?? "Search…"}
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            className="h-9 pl-8"
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        {columns && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
              >
                <Columns3 className="size-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.items.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.visible}
                  onCheckedChange={(checked) => columns.onToggle(col.id, !!checked)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {end}
      </div>
    </div>
  );
}
