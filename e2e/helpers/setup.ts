// e2e/helpers/setup.ts
import { test as base, type Page } from '@playwright/test';

const orgSlug = process.env.FLUXAOS_ORG_SLUG;
const userSlug = process.env.FLUXAOS_USER_SLUG;
const projectSlug = process.env.FLUXAOS_PROJECT_SLUG;

if (!orgSlug || !userSlug || !projectSlug) {
  const missing = [
    !orgSlug && 'FLUXAOS_ORG_SLUG',
    !userSlug && 'FLUXAOS_USER_SLUG',
    !projectSlug && 'FLUXAOS_PROJECT_SLUG',
  ]
    .filter(Boolean)
    .join(', ');
  throw new Error(
    `e2e setup: missing required env var(s): ${missing}. Set them in .env.local alongside DATABASE_URL.`
  );
}

const PROJECT_BASE = `/${orgSlug}/${userSlug}/${projectSlug}`;

export const test = base.extend({});
export const expect = base.expect;

export function projectPath(sub: string): string {
  return `${PROJECT_BASE}${sub.startsWith('/') ? sub : `/${sub}`}`;
}

/** Navigate to a settings sub-page under the seeded project. */
export async function gotoSettings(page: Page, sub: string): Promise<void> {
  await page.goto(projectPath(`/settings/${sub}`));
}
