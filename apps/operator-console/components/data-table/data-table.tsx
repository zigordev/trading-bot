"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type RowData,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right" | "center";
    sticky?: "left";
    headerClassName?: string;
    cellClassName?: string;
    hideOnNarrow?: boolean;
  }
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  rowKey?: (row: TData) => string;
  isLoading?: boolean;
  loadingRows?: number;
  empty?: React.ReactNode;
  onRowClick?: (row: TData) => void;
  rowClassName?: (row: TData) => string | undefined;
  rowAriaLabel?: (row: TData) => string;
  state?: {
    sorting?: SortingState;
    onSortingChange?: (next: SortingState) => void;
    columnVisibility?: VisibilityState;
    onColumnVisibilityChange?: (next: VisibilityState) => void;
    columnFilters?: ColumnFiltersState;
    onColumnFiltersChange?: (next: ColumnFiltersState) => void;
    globalFilter?: string;
    onGlobalFilterChange?: (next: string) => void;
  };
  manualPagination?: boolean;
  pageCount?: number;
  pageSize?: number;
  pageIndex?: number;
  onPaginationChange?: (next: { pageIndex: number; pageSize: number }) => void;
  enableInternalPagination?: boolean;
  className?: string;
  tableClassName?: string;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
}

export function DataTable<TData>({
  columns,
  data,
  rowKey,
  isLoading = false,
  loadingRows = 8,
  empty,
  onRowClick,
  rowClassName,
  rowAriaLabel,
  state,
  manualPagination = false,
  pageCount,
  pageSize = 25,
  pageIndex = 0,
  onPaginationChange,
  enableInternalPagination = true,
  className,
  tableClassName,
  toolbar,
  footer,
}: DataTableProps<TData>) {
  const isPaginationControlled = manualPagination || Boolean(onPaginationChange);
  const [internalPagination, setInternalPagination] = React.useState({
    pageIndex,
    pageSize,
  });
  const pagination = isPaginationControlled
    ? { pageIndex, pageSize }
    : internalPagination;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel:
      enableInternalPagination && !manualPagination
        ? getPaginationRowModel()
        : undefined,
    manualPagination,
    pageCount,
    state: {
      sorting: state?.sorting,
      columnVisibility: state?.columnVisibility,
      columnFilters: state?.columnFilters,
      globalFilter: state?.globalFilter,
      pagination,
    },
    onSortingChange: state?.onSortingChange
      ? (updater) => {
          const next =
            typeof updater === "function"
              ? updater(state.sorting ?? [])
              : updater;
          state.onSortingChange?.(next);
        }
      : undefined,
    onColumnVisibilityChange: state?.onColumnVisibilityChange
      ? (updater) => {
          const next =
            typeof updater === "function"
              ? updater(state.columnVisibility ?? {})
              : updater;
          state.onColumnVisibilityChange?.(next);
        }
      : undefined,
    onColumnFiltersChange: state?.onColumnFiltersChange
      ? (updater) => {
          const next =
            typeof updater === "function"
              ? updater(state.columnFilters ?? [])
              : updater;
          state.onColumnFiltersChange?.(next);
        }
      : undefined,
    onGlobalFilterChange: state?.onGlobalFilterChange,
    onPaginationChange: (updater) => {
      const prev = pagination;
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (onPaginationChange) onPaginationChange(next);
      if (!isPaginationControlled) setInternalPagination(next);
    },
  });

return (
    <div className={cn("flex flex-col gap-3", className)}>
      {toolbar}
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="overflow-x-auto">
          <table
            className={cn(
              "w-full border-collapse text-[13px]",
              "num",
              tableClassName,
            )}
          >
            <thead className="bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-[var(--color-border)]">
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    const align = meta?.align ?? "left";
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        className={cn(
                          "h-9 select-none px-3 text-[11px] font-semibold uppercase tracking-wide",
                          align === "right" && "text-right",
                          align === "center" && "text-center",
                          meta?.sticky === "left" &&
                            "sticky left-0 z-10 bg-[var(--color-surface-2)]",
                          meta?.hideOnNarrow && "hidden md:table-cell",
                          meta?.headerClassName,
                        )}
                        style={{ width: header.getSize() === 150 ? undefined : header.getSize() }}
                      >
                        {header.isPlaceholder ? null : (
                          <button
                            type="button"
                            disabled={!canSort}
                            onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                            className={cn(
                              "inline-flex items-center gap-1.5",
                              align === "right" && "ml-auto",
                              align === "center" && "mx-auto",
                              canSort && "hover:text-[var(--color-fg)]",
                            )}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                            {canSort && (
                              <span className="text-[var(--color-fg-subtle)]">
                                {sorted === "asc" ? (
                                  <ArrowUp className="size-3" />
                                ) : sorted === "desc" ? (
                                  <ArrowDown className="size-3" />
                                ) : (
                                  <ArrowUpDown className="size-3 opacity-50" />
                                )}
                              </span>
                            )}
                          </button>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: loadingRows }).map((_, rowIdx) => (
                  <tr
                    key={`loading-${rowIdx}`}
                    className="border-b border-[var(--color-border)]"
                  >
                    {table.getVisibleLeafColumns().map((column, colIdx) => (
                      <td
                        key={`loading-${rowIdx}-${colIdx}`}
                        className="h-9 px-3 align-middle"
                      >
                        <Skeleton className="h-3 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={table.getVisibleLeafColumns().length}
                    className="px-3 py-12 text-center text-[var(--color-fg-subtle)]"
                  >
                    {empty ?? "No results."}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={rowKey ? rowKey(row.original) : row.id}
                    className={cn(
                      "border-b border-[var(--color-border)] transition-colors",
                      onRowClick &&
                        "cursor-pointer hover:bg-[var(--color-surface-2)]",
                      rowClassName?.(row.original),
                    )}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    aria-label={rowAriaLabel?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      const align = meta?.align ?? "left";
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            "h-9 px-3 align-middle",
                            align === "right" && "text-right",
                            align === "center" && "text-center",
                            meta?.sticky === "left" &&
                              "sticky left-0 bg-[var(--color-surface)]",
                            meta?.hideOnNarrow && "hidden md:table-cell",
                            meta?.cellClassName,
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {footer ?? <DataTablePagination table={table} />}
    </div>
  );
}

interface DataTablePaginationProps<TData> {
  table: TanstackTable<TData>;
  pageSizeOptions?: number[];
}

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 25, 50, 100],
}: DataTablePaginationProps<TData>) {
  const totalRows = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const start = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min(totalRows, (pageIndex + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[12px] text-[var(--color-fg-subtle)]">
      <div className="num">
        {totalRows > 0
          ? `${start.toLocaleString()}–${end.toLocaleString()} of ${totalRows.toLocaleString()}`
          : "No rows"}
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
            className="h-7 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[12px]"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft />
          </Button>
          <span className="num min-w-[64px] text-center">
            {pageIndex + 1} / {Math.max(1, table.getPageCount())}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
