import * as React from 'react';

export interface TableProps {
  /** Strip above the header row. A string gets uppercase label typography;
   *  any other node is left alone, so it can hold filters or a search box. */
  caption?: React.ReactNode;
  /** Strip below the table, in the same frame — pagination, totals, a count. */
  footer?: React.ReactNode;
  /** Floor for the table's width — below it, the frame scrolls horizontally
   *  instead of crushing columns. Required for frozen (sticky-left) columns
   *  to be worth anything. */
  minWidth?: number | string;
  /** Caps the scroll container's height, which is what makes the always-sticky header stick. */
  maxHeight?: number | string;
  /** `compact` tightens cell padding for stat tables — the kind with ten
   *  numeric columns, where default padding is what pushes it off-screen.
   *  @default 'default' */
  density?: 'default' | 'compact';
  /** Row hover highlight. @default true */
  hoverable?: boolean;
  /** Alternating row shading. Helps on wide tables, noise on narrow ones. */
  zebra?: boolean;
  /** `<thead>` / `<tbody>` — the table's own markup. */
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export declare function Table(props: TableProps): JSX.Element;

export interface TableSortHeaderProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Current sort on this column, or null when it is not the active one. */
  direction?: 'asc' | 'desc' | null;
  /** Omit to render the label with no affordance (a non-sortable column). */
  onSort?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}

export interface TablePagerProps {
  /** Already-translated range/count text, e.g. "1–20 of 137". */
  summary?: React.ReactNode;
  /** Already-translated label for the page-size picker, e.g. "Rows". */
  rowsLabel?: React.ReactNode;
  /** 1-based. TanStack's pageIndex is 0-based — convert at the boundary. */
  page: number;
  pageCount?: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  /** Both this and onPageSizeChange are needed for the picker to appear. */
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  prevLabel?: string;
  nextLabel?: string;
}

export interface TableEmptyProps {
  /** Defaults to 99; browsers clamp it to the real column count. */
  colSpan?: number;
  children: React.ReactNode;
}

export declare function TableSortHeader(props: TableSortHeaderProps): JSX.Element;
export declare function TablePager(props: TablePagerProps): JSX.Element;
export declare function TableEmpty(props: TableEmptyProps): JSX.Element;
