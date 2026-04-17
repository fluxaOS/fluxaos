// src/app/[org]/[user]/[project]/settings/drivers/page.tsx
'use client';

import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { Feature, hasFeature } from '@/core/features/features';
import { trpc } from '@/lib/trpc/client';
import { driverDescriptor, type DriverRecord } from './descriptor';

export default function DriversSettingsPage() {
  const utils = trpc.useUtils();
  const listQuery = trpc.driver.list.useQuery();
  const updateMutation = trpc.driver.update.useMutation();

  const records = (listQuery.data ?? []) as unknown as DriverRecord[];

  const onSave = async (
    id: string,
    patch: Partial<DriverRecord>,
    expectedVersion: number,
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...(patch as Record<string, unknown>),
    });
    await utils.driver.list.invalidate();
  };

  const onToggleEnabled = async (
    id: string,
    enabled: boolean,
    expectedVersion: number,
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      isEnabled: enabled,
    });
    await utils.driver.list.invalidate();
  };

  // Placeholder user — replace with real auth context when available.
  const userId = 'local-dev';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Drivers"
        description="Definitions for each AI CLI tool fluxaOS invokes (binary, flags, transport, env)."
      />

      <RecordEditor<DriverRecord>
        descriptor={driverDescriptor}
        records={records}
        isLoading={listQuery.isLoading}
        onSave={onSave}
        onToggleEnabled={onToggleEnabled}
        onRefresh={async () => {
          await utils.driver.list.invalidate();
        }}
        // DEF-002 role gates — today always true (see features.ts)
        canEdit={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
        canDelete={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
      />
    </div>
  );
}
