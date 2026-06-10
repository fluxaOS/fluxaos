// src/app/p/[projectUuid]/settings/users/descriptor.ts
import type { RecordDescriptor } from '@/components/record-editor/types';
import { ROLE_VALUES } from '@/core/features/roles';

export type UserRecord = {
  id: string;
  version: number;
  orgId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
};

export const userDescriptor: RecordDescriptor<UserRecord> = {
  entityName: 'user',
  title: (u) => u.name,
  subtitle: (u) => u.email,
  fields: [
    { key: 'name', label: 'Name', fieldType: 'text', required: true },
    {
      key: 'email',
      label: 'Email',
      fieldType: 'text',
      required: true,
      validate: (v) => {
        if (typeof v !== 'string' || !v) return 'Required';
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Invalid email';
      },
    },
    {
      key: 'role',
      label: 'Role',
      fieldType: 'select',
      required: true,
      // FLX-12: 'admin' | 'maintainer' | 'viewer'.
      options: ROLE_VALUES,
    },
    {
      key: 'avatarUrl',
      label: 'Avatar URL',
      fieldType: 'text',
      placeholder: 'https://…',
      validate: (v) => {
        if (v == null || v === '') return null;
        if (typeof v !== 'string') return 'Must be a string';
        try {
          new URL(v);
          return null;
        } catch {
          return 'Must be a valid URL';
        }
      },
    },
    { key: 'version', label: 'Version', fieldType: 'readonly' },
  ],
};
