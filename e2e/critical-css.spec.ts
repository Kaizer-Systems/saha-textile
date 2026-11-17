import { expect, test } from './support';

/**
 * Critical CSS (speed baseline, option A): Home's first visit after a start is sent as drawn while the server works
 * out its critical CSS off the request path; later visits carry it inlined, and the full stylesheets no longer block
 * the first paint. The page must look the same either way.
 */
test.describe('critical CSS on Home', () => {
	test('is worked out once, then inlined, with the stylesheets loading without blocking', async ({
		page,
		request,
	}) => {
		let state = '';
		for (let tries = 0; tries < 30 && state !== 'inlined'; tries++) {
			const answer = await request.get('/en/');
			state = answer.headers()['x-st-critical'] ?? '';
			if (state !== 'inlined') await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		expect(state).toBe('inlined');

		await page.goto('/en/');
		await expect(page.locator('style[data-st-critical]')).toHaveCount(1);
		// Each local stylesheet was sent as media="print" and switched to all once loaded: none is left unapplied.
		await page.waitForLoadState('load');
		const unapplied = await page.evaluate(
			() =>
				[...document.head.querySelectorAll('link[rel="stylesheet"]')].filter((link) => {
					const href = link.getAttribute('href') ?? '';
					return (
						href.startsWith('/') &&
						link.closest('noscript') === null &&
						link.getAttribute('media') === 'print'
					);
				}).length,
		);
		expect(unapplied).toBe(0);
		// Browsers without JavaScript still get the stylesheets (noscript holds them as markup while scripts run).
		expect(await page.evaluate(() => document.head.innerHTML)).toMatch(
			/<noscript><link rel="stylesheet"[^>]*href="\/assets\//,
		);
		// Once loaded, the full stylesheet applies: the page is styled as before (the header keeps its layout).
		await expect(page.locator('header')).toBeVisible();
		await expect(page.locator('h1')).toHaveCount(1);
	});

	test('leaves pages that take no part as they are', async ({ request }) => {
		const answer = await request.get('/en/collections');
		expect(answer.headers()['x-st-critical']).toBeUndefined();
	});
});
