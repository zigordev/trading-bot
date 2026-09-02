'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Edit3, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { useDeleteConfigResource } from '@/lib/hooks/use-config-resource';
import type { ConfigField, ConfigResourceDefinition } from '@/lib/configuration/schemas';
import { AssetLabel, PairLabel } from '@/components/shared/symbol-avatar';
import { usePreferences } from '@/components/providers/preferences-provider';

interface ConfigTableProps {
  resource: ConfigResourceDefinition;
  records: Record<string, unknown>[];
  isLoading?: boolean;
  onEdit: (record: Record<string, unknown>) => void;
  onCreate: () => void;
}

export function ConfigTable({ resource, records, isLoading, onEdit, onCreate }: ConfigTableProps) {
  const { t } = usePreferences();
  const [search, setSearch] = React.useState('');
  const resourceLabel = t(resource.labelKey).toLowerCase();
  const singularLabel = t(resource.labelSingularKey).toLowerCase();
  const [pendingDelete, setPendingDelete] = React.useState<Record<string, unknown> | null>(null);
  const remove = useDeleteConfigResource(resource.endpoint);

  const columns = React.useMemo<ColumnDef<Record<string, unknown>, unknown>[]>(() => {
    const summaryFields = resource.fields
      .filter((f) => f.kind !== 'json' && f.kind !== 'promotion-thresholds')
      .slice(0, 4);

    return [
      ...summaryFields.map<ColumnDef<Record<string, unknown>, unknown>>((field) => {
        const path = field.name;
        return {
          id: path,
          accessorFn: (row) => readPath(row, path),
          header: t(field.labelKey),
          cell: ({ row }) => formatValue(field.kind, readPath(row.original, path), t),
        };
      }),
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={(event) => {
                event.stopPropagation();
                onEdit(row.original);
              }}
              aria-label={t('configuration.actions.edit')}
              className="text-[var(--color-fg-subtle)]"
            >
              <Edit3 />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-[var(--color-fg-subtle)]"
                  onClick={(event) => event.stopPropagation()}
                  aria-label={t('configuration.actions.more_actions')}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit({
                      ...row.original,
                      [resource.idField ?? resource.titleField]: '',
                    });
                  }}
                >
                  {t('configuration.actions.duplicate')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-[var(--color-danger)] focus:text-[var(--color-danger)]"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingDelete(row.original);
                  }}
                >
                  <Trash2 className="size-3.5" />
                  {t('configuration.actions.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ];
  }, [resource, onEdit, t]);

  return (
    <>
      <DataTable
        columns={columns}
        data={records}
        rowKey={(row) => String(readPath(row, resource.idField ?? resource.titleField))}
        isLoading={isLoading}
        onRowClick={onEdit}
        empty={
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="text-[13px] text-[var(--color-fg-subtle)]">
              {t('configuration.empty.no_records', { resource: resourceLabel })}
            </div>
            <Button size="sm" className="gap-1.5" onClick={onCreate}>
              <Plus className="size-3.5" />
              {t('configuration.actions.add')} {singularLabel}
            </Button>
          </div>
        }
        pageSize={25}
        state={{ globalFilter: search, onGlobalFilterChange: setSearch }}
        toolbar={
          <DataTableToolbar
            search={{
              value: search,
              onChange: setSearch,
              placeholder: t('configuration.actions.search_placeholder', {
                resource: resourceLabel,
              }),
            }}
            end={
              <Button size="sm" className="gap-1.5" onClick={onCreate}>
                <Plus className="size-3.5" />
                {t('configuration.actions.add')} {singularLabel}
              </Button>
            }
          />
        }
      />

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('configuration.confirm.delete_title', {
                name: String(pendingDelete ? readPath(pendingDelete, resource.titleField) : ''),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('configuration.confirm.delete_description', {
                resource: resourceLabel,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t('configuration.actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={async (event) => {
                event.preventDefault();
                if (!pendingDelete) return;
                const id = String(readPath(pendingDelete, resource.idField ?? resource.titleField));
                const promise = remove.mutateAsync(id);
                toast.promise(promise, {
                  loading: t('toast.config_delete.loading'),
                  success: t('toast.config_delete.success'),
                  error: (err) =>
                    err instanceof Error ? err.message : t('toast.config_delete.error'),
                });
                try {
                  await promise;
                  setPendingDelete(null);
                } catch {
                  // toast already handled
                }
              }}
            >
              {t('configuration.actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function readPath(row: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cursor: unknown = row;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function formatValue(
  kind: ConfigField['kind'],
  value: unknown,
  t: ReturnType<typeof usePreferences>['t']
): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-[var(--color-fg-subtle)]">—</span>;
  }
  if (kind === 'boolean') {
    return (
      <Badge variant={value ? 'success' : 'default'}>
        {value ? t('configuration.actions.yes') : t('configuration.actions.no')}
      </Badge>
    );
  }
  if (kind === 'number') {
    return <span className="num text-[12px]">{Number(value).toLocaleString()}</span>;
  }
  if (kind === 'symbol' && typeof value === 'string') {
    return <PairLabel code={value} size={18} textClassName="text-[12px]" />;
  }
  if (kind === 'asset-display' && typeof value === 'string') {
    return <AssetLabel asset={value} size={16} textClassName="text-[12px]" />;
  }
  if (typeof value === 'string') {
    return <span className="text-[12px] text-[var(--color-fg)]">{value}</span>;
  }
  return (
    <span className="font-mono text-[11px] text-[var(--color-fg-muted)]">{String(value)}</span>
  );
}
