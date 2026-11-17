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
		// The first paint draws with the faces whose file the page preloads (Public Sans' English letters, the icon
		// font) and the measured Public Sans fallback (a font on the device). No other face is declared early, so the
		// critical CSS never starts a font download of its own; those arrive with the full stylesheets.
		const critical = (await page.locator('style[data-st-critical]').textContent()) ?? '';
		expect(critical).toContain('/assets/fonts/text/public-sans-normal-100-900-latin.woff2');
		expect(critical).toMatch(/@font-face\s*\{[^}]*font-family:\s*["']?remixicon/);
		expect(critical).toContain('/assets/fonts/remixicon/remixicon.woff2?t=1690730386070');
		expect(critical).toMatch(
			/@font-face\s*\{[^}]*font-family:\s*["']?Public Sans Fallback["']?;[^}]*src:\s*local\(/,
		);
		expect(critical).not.toMatch(/noto-sans-bengali|italic-100-900|latin-ext\.woff2|\.\.\/fonts\//);
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

	test('in বাংলা too, the critical CSS starts no font download of its own', async ({ request }) => {
		let html = '';
		for (let tries = 0; tries < 30; tries++) {
			const answer = await request.get('/bn/');
			if (answer.headers()['x-st-critical'] === 'inlined') {
				html = await answer.text();
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		const critical = /<style data-st-critical>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
		expect(critical).toContain('Public Sans Fallback');
		// The Bengali font is not preloaded, so it comes with the full stylesheets, as before critical CSS.
		expect(critical).not.toContain('noto-sans-bengali');
	});

	test("the measured fallback takes Public Sans' room, so text keeps its place while the font loads", async ({
		page,
	}) => {
		// Text boxes on Home's first screen: header words and section titles, in page order.
		const boxes = () =>
			page.evaluate(() =>
				[...document.querySelectorAll('header a, header span, header button, h2')]
					.filter((element) => {
						const box = element.getBoundingClientRect();
						const text = (element.textContent ?? '').trim();
						return (
							box.width > 0 && box.top < innerHeight && text.length > 2 && element.children.length === 0
						);
					})
					.map((element) => {
						const box = element.getBoundingClientRect();
						return {
							text: (element.textContent ?? '').trim().slice(0, 30),
							width: box.width,
							height: box.height,
						};
					}),
			);
		let blocked = 0;
		await page.route('**/assets/fonts/text/public-sans-*', (route) => {
			blocked++;
			return route.abort();
		});
		await page.goto('/en/');
		await page.waitForLoadState('load');
		await page.evaluate(() => document.fonts.ready);
		const fallback = await boxes();
		expect(blocked).toBeGreaterThan(0);

		await page.unroute('**/assets/fonts/text/public-sans-*');
		await page.goto('/en/');
		await page.waitForLoadState('load');
		await page.evaluate(() => document.fonts.ready);
		const real = await boxes();

		expect(real.map((box) => box.text)).toEqual(fallback.map((box) => box.text));
		expect(real.length).toBeGreaterThan(3);
		const total = (list: { width: number }[]) => list.reduce((sum, box) => sum + box.width, 0);
		console.log(
			`fallback vs Public Sans: total width ${total(fallback).toFixed(1)} vs ${total(real).toFixed(1)}; ` +
				real
					.map((box, index) => `${box.text}: ${fallback[index]?.width.toFixed(1)}/${box.width.toFixed(1)}`)
					.join(', '),
		);
		// Same line boxes (ascent, descent and line gap match), and the words take about the same width in all.
		real.forEach((box, index) =>
			expect(Math.abs(box.height - (fallback[index]?.height ?? 0))).toBeLessThanOrEqual(1),
		);
		expect(Math.abs(total(fallback) / total(real) - 1)).toBeLessThan(0.03);
	});

	test('leaves pages that take no part as they are', async ({ request }) => {
		const answer = await request.get('/en/collections');
		expect(answer.headers()['x-st-critical']).toBeUndefined();
	});
});
