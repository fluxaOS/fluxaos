// src/app/[org]/[user]/[project]/settings/users/descriptor.ts
import type { RecordDescriptor } from '@/components/record-editor/types';

export type UserRecord = {
  id: string;
  version: number;
  orgId: string;
  name: string;
  email: string;
  slug: string;
  avatarUrl: string | null;
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
      key: 'slug',
      label: 'Slug',
      fieldType: 'text',
      required: true,
      placeholder: 'kebab-case identifier',
      validate: (v) => {
        if (typeof v !== 'string' || !v) return 'Required';
        return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)
          ? null
          : 'Must be kebab-case (lowercase letters, digits, dashes)';
      },
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
