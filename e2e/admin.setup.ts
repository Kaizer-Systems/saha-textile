import { expect, test as setup } from '@playwright/test';

import { ADMIN, ADMIN_STATE } from './support';

/** Signs the test administrator in once; the admin tests reuse the session. */
setup('sign in as the test administrator', async ({ page }) => {
	const email = process.env['E2E_ADMIN_EMAIL'];
	const password = process.env['E2E_ADMIN_PASSWORD'];
	setup.skip(!email || !password, 'needs `pnpm e2e:stack`, which creates the test administrator');
	await page.goto(`${ADMIN}/auth/login`);
	await page.waitForLoadState('networkidle');
	await page.locator('input[formcontrolname="identifier"]').fill(email as string);
	await page.locator('input[formcontrolname="password"]').fill(password as string);
	await page.locator('app-button button').first().click();
	await expect(page).toHaveURL(/\/dashboard/);
	await page.context().storageState({ path: ADMIN_STATE });
});
