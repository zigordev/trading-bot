'use client';

import * as React from 'react';
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
} from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { usePreferences } from '@/components/providers/preferences-provider';
// design-system, copied in — see apps/operator-console/design-system/.
import {
  Table as DsTable,
  TableSortHeader,
  TablePager,
  TableEmpty,
} from '@ds/components/data-display/Table.jsx';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'left' | 'right' | 'center';
    sticky?: 'left';
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
  const { t } = usePreferences();
  const isPaginationControlled = manualPagination || Boolean(onPaginationChange);
  const [internalPagination, setInternalPagination] = React.useState({
    pageIndex,
    pageSize,
  });
  const pagination = isPaginationControlled ? { pageIndex, pageSize } : internalPagination;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel:
      enableInternalPagination && !manualPagination ? getPaginationRowModel() : undefined,
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
          const next = typeof updater === 'function' ? updater(state.sorting ?? []) : updater;
          state.onSortingChange?.(next);
        }
      : undefined,
    onColumnVisibilityChange: state?.onColumnVisibilityChange
      ? (updater) => {
          const next =
            typeof updater === 'function' ? updater(state.columnVisibility ?? {}) : updater;
          state.onColumnVisibilityChange?.(next);
        }
      : undefined,
    onColumnFiltersChange: state?.onColumnFiltersChange
      ? (updater) => {
          const next = typeof updater === 'function' ? updater(state.columnFilters ?? []) : updater;
          state.onColumnFiltersChange?.(next);
        }
      : undefined,
    onGlobalFilterChange: state?.onGlobalFilterChange,
    onPaginationChange: (updater) => {
      const prev = pagination;
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (onPaginationChange) onPaginationChange(next);
      if (!isPaginationControlled) setInternalPagination(next);
    },
  });

  return (
    <div className={className}>
      {/* Filters and pagination belong to the table, so they live in its
          frame — the caption and footer slots — rather than floating above
          and below it. */}
      <DsTable
        className={cn('num', tableClassName)}
        caption={toolbar}
        footer={footer ?? <DataTablePagination table={table} />}
      >
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const align = meta?.align ?? 'left';
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={cn(
                      align === 'right' && 'text-right',
                      align === 'center' && 'text-center',
                      meta?.sticky === 'left' && 'sticky left-0 z-10 bg-[var(--color-surface-2)]',
                      meta?.hideOnNarrow && 'hidden md:table-cell',
                      meta?.headerClassName
                    )}
                    style={{ width: header.getSize() === 150 ? undefined : header.getSize() }}
                  >
                    {header.isPlaceholder ? null : (
                      <TableSortHeader
                        direction={sorted === false ? null : sorted}
                        onSort={canSort ? () => header.column.toggleSorting(undefined) : undefined}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </TableSortHeader>
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
              <tr key={`loading-${rowIdx}`}>
                {table.getVisibleLeafColumns().map((column, colIdx) => (
                  <td key={`loading-${rowIdx}-${colIdx}`}>
                    <Skeleton className="h-3 w-3/4" />
                  </td>
                ))}
              </tr>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            <TableEmpty colSpan={table.getVisibleLeafColumns().length}>
              {empty ?? t('data_table.no_results')}
            </TableEmpty>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={rowKey ? rowKey(row.original) : row.id}
                className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row.original))}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                aria-label={rowAriaLabel?.(row.original)}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta;
                  const align = meta?.align ?? 'left';
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        align === 'right' && 'text-right',
                        align === 'center' && 'text-center',
                        meta?.sticky === 'left' && 'sticky left-0 bg-[var(--color-surface)]',
                        meta?.hideOnNarrow && 'hidden md:table-cell',
                        meta?.cellClassName
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
      </DsTable>
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
  const { t } = usePreferences();
  const totalRows = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const start = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min(totalRows, (pageIndex + 1) * pageSize);

  return (
    <TablePager
      summary={
        totalRows > 0
          ? t('data_table.pagination_range', {
              start: start.toLocaleString(),
              end: end.toLocaleString(),
              total: totalRows.toLocaleString(),
            })
          : t('data_table.no_rows')
      }
      rowsLabel={t('data_table.rows')}
      // TanStack counts pages from 0; TablePager from 1.
      page={pageIndex + 1}
      pageCount={table.getPageCount()}
      onPageChange={(next) => table.setPageIndex(next - 1)}
      pageSize={pageSize}
      pageSizeOptions={pageSizeOptions}
      onPageSizeChange={(size) => table.setPageSize(size)}
      prevLabel={t('data_table.previous_page')}
      nextLabel={t('data_table.next_page')}
    />
  );
}
