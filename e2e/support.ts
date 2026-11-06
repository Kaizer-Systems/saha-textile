import { expect, test as base, type Page } from '@playwright/test';

/** The API a shop page talks to. Tests stub or block it by this pattern. */
export const API = /localhost:4000/;

/** Everything the shop shouldn't do on a healthy page, collected per test. */
interface Problems {
	errors: string[];
	failed: string[];
}

export const test = base.extend<{ problems: Problems }>({
	page: async ({ page }, use) => {
		await page.addLocatorHandler(page.locator('#newsletter_modal_close_btn'), (close) => close.click());
		// The consent bar is a fixed overlay with no bearing on these flows.
		await page.addInitScript(() => {
			addEventListener('DOMContentLoaded', () => {
				const style = document.createElement('style');
				style.textContent = '.cookie-bar-box { display: none !important; }';
				document.head.append(style);
			});
		});
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
	if (await open.isVisible()) await open.click();
}
