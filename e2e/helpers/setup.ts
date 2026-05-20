// e2e/helpers/setup.ts
import { test as base, type Page } from '@playwright/test';

const projectId = process.env.FLUXAOS_PROJECT_ID;

if (!projectId) {
  throw new Error(
    'e2e setup: missing required env var: FLUXAOS_PROJECT_ID. Set it in .env.local alongside DATABASE_URL.'
  );
}

const PROJECT_BASE = `/p/${projectId}`;

export const test = base.extend({});
export const expect = base.expect;

export function projectPath(sub: string): string {
  return `${PROJECT_BASE}${sub.startsWith('/') ? sub : `/${sub}`}`;
}

/** Navigate to a settings sub-page under the seeded project. */
export async function gotoSettings(page: Page, sub: string): Promise<void> {
  await page.goto(projectPath(`/settings/${sub}`));
}
