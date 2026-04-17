// e2e/helpers/setup.ts
import { test as base, type Page } from '@playwright/test';

const PROJECT_BASE = '/default/admin/fluxaos';

export const test = base.extend({});
export const expect = base.expect;

export function projectPath(sub: string): string {
  return `${PROJECT_BASE}${sub.startsWith('/') ? sub : `/${sub}`}`;
}

/** Navigate to a settings sub-page under the seeded project. */
export async function gotoSettings(page: Page, sub: string): Promise<void> {
  await page.goto(projectPath(`/settings/${sub}`));
}
