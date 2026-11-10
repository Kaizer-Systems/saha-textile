import { expect, test as base, type Page } from '@playwright/test';

import { COOKIE_POLICY_VERSION } from '../apps/storefront/src/app/core/consent/cookie-catalogue';

/**
 * Where the stack runs. The defaults are the ports `pnpm e2e:stack` and the local servers use;
 * `E2E_API_URL`, `E2E_BASE_URL` and `E2E_ADMIN_URL` point the tests at another copy, such as a
 * worktree's on its own ports, so the local servers can keep running.
 */
export const API_URL = process.env['E2E_API_URL'] ?? 'https://localhost:4000';
export const SHOP = process.env['E2E_BASE_URL'] ?? 'https://localhost:4200';
export const ADMIN = process.env['E2E_ADMIN_URL'] ?? 'https://localhost:4300';

/** The API a shop page talks to. Tests stub or block it by this pattern. */
export const API = new RegExp(new URL(API_URL).host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/** The signed-in test administrator, written by `admin.setup.ts`. */
export const ADMIN_STATE = 'node_modules/.cache/playwright/admin-state.json';

/**
 * A visitor who has already answered, so the cookie box stays out of flows it has no part in. The
 * version is the shop's own, so raising it (a new tool in a category) does not silently switch
 * Functional off for every test, as YouTube joining the list did on 2026-11-10.
 */
const ACCEPTED_COOKIES = {
	name: 'st_consent',
	value: encodeURIComponent(
		JSON.stringify({
			id: '3f0e8f6e-7f1b-4c55-9a55-1d9f6e1a0001',
			version: COOKIE_POLICY_VERSION,
			savedAt: '2026-11-07T00:00:00.000Z',
			categories: { functional: true, analytics: false, targeting: false, marketing: false, promotional: false },
		}),
	),
	domain: 'localhost',
	path: '/',
};

/** Everything the shop shouldn't do on a healthy page, collected per test. */
interface Problems {
	errors: string[];
	failed: string[];
}

export const test = base.extend<{ problems: Problems }>({
	page: async ({ page }, use) => {
		await page.addLocatorHandler(page.locator('#newsletter_modal_close_btn'), (close) => close.click());
		await page.context().addCookies([ACCEPTED_COOKIES]);
		await use(page);
	},
	problems: async ({ page }, use) => {
		const problems: Problems = { errors: [], failed: [] };
		page.on('pageerror', (error) => problems.errors.push(error.message));
		page.on('response', (response) => {
			if (response.status() >= 500) problems.failed.push(`${response.status()} ${response.url()}`);
		});
		await use(problems);
	},
});

export { expect };

export const cards = (page: Page) => page.locator('app-collection-products app-product-box');

export async function openFilter(page: Page, title: string): Promise<void> {
	const header = page.locator('.accordion-button', { hasText: title }).first();
	if ((await header.getAttribute('class'))?.includes('collapsed')) await header.click();
}

/** On a phone the filters live in a drawer behind the Filter button. */
export async function showFilters(page: Page): Promise<void> {
	const open = page.locator('.filter-button a').first();
	if (!(await open.isVisible())) return;
	const drawer = page.locator('.left-box.show');
	// A tap before the page is interactive is lost, so tap until the drawer really opens.
	await expect(async () => {
		if (!(await drawer.count())) await open.click();
		await expect(drawer).toHaveCount(1, { timeout: 1000 });
	}).toPass();
}
