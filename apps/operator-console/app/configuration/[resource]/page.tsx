'use client';

import * as React from 'react';
import { notFound, useParams } from 'next/navigation';

import { ErrorState } from '@/components/shared/error-state';
import { useConfigResource } from '@/lib/hooks/use-config-resource';
import { configResources } from '@/lib/configuration/schemas';
import { usePreferences } from '@/components/providers/preferences-provider';

import { ConfigTable } from '../_components/config-table';
import { ConfigFormSheet } from '../_components/config-form-sheet';

export default function ConfigurationResourcePage() {
  const params = useParams<{ resource: string }>();
  const resource = configResources[params.resource];
  const { t } = usePreferences();
  if (!resource) {
    notFound();
  }

  const records = useConfigResource(resource.endpoint);
  const [editing, setEditing] = React.useState<Record<string, unknown> | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);

  const openCreate = () => {
    setEditing(null);
    setIsOpen(true);
  };

  const openEdit = (record: Record<string, unknown>) => {
    setEditing(record);
    setIsOpen(true);
  };

  return (
    <>
      {records.isError ? (
        <ErrorState
          title={`Failed to load ${t(resource.labelKey).toLowerCase()}`}
          description="The control plane returned an error."
          onRetry={() => records.refetch()}
        />
      ) : (
        <ConfigTable
          resource={resource}
          records={records.data ?? []}
          isLoading={records.isLoading}
          onEdit={openEdit}
          onCreate={openCreate}
        />
      )}

      <ConfigFormSheet
        resource={resource}
        open={isOpen}
        onOpenChange={(next) => {
          setIsOpen(next);
          if (!next) setEditing(null);
        }}
        initial={editing}
      />
    </>
  );
}
