import { expect, test, type Browser, type Page } from '@playwright/test';

import { firstScreen, lowContrast } from './colour-checks';
import { SHOP } from './support';

/**
 * Two guards for the light/dark modes, run on every pull request:
 *
 * 1. Contrast: every visible piece of text reaches WCAG AA against the colour behind it (4.5 : 1,
 *    or 3 : 1 for large text; against every stop of a gradient), in light and in dark mode. Text
 *    over a photograph and decorative rating stars are skipped: a colour check cannot judge a
 *    picture.
 * 2. Parity: the first screen of each page has the same layout in both modes. Dark mode may only
 *    change colours (apps/storefront/scripts/build-dark-theme.mjs); a size, spacing or font that
 *    differs means a dark rule leaked layout.
 */

const PAGES = [
	'/en/',
	'/en/collections/sarees',
	'/en/auth/login',
	'/en/blogs',
	'/en/contact-us',
	'/en/faq',
	'/en/cart',
];

async function open(
	browser: Browser,
	mode: 'light' | 'dark',
	path: string,
	viewport: { width: number; height: number } | null,
): Promise<Page> {
	const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
	await context.addCookies([
		{ name: 'st_theme', value: mode, url: SHOP },
		{ name: 'st_newsletter', value: 'never', url: SHOP },
	]);
	const page = await context.newPage();
	await page.goto(path, { waitUntil: 'networkidle' });
	await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
	await page.waitForTimeout(500);
	return page;
}

for (const path of PAGES) {
	test(`text on ${path} is readable in light and dark mode`, async ({ browser, viewport }) => {
		for (const mode of ['light', 'dark'] as const) {
			const page = await open(browser, mode, path, viewport);
			// Banner text sits on photographs, the same in both modes.
			const options = { blend: false, skipCovered: false, skip: '.home-contain, .banner-contain' };
			expect(await page.evaluate(lowContrast, options), `${mode} mode`).toEqual([]);
			await page.context().close();
		}
	});

	test(`${path} has the same layout in light and dark mode`, async ({ browser, viewport }) => {
		const light = await open(browser, 'light', path, viewport);
		const dark = await open(browser, 'dark', path, viewport);
		const skip = '.cookie-bar-box, .toast-container';
		const [before, after] = await Promise.all([
			light.evaluate(firstScreen, skip),
			dark.evaluate(firstScreen, skip),
		]);
		const changed = Object.keys(before).filter((key) => key in after && before[key] !== after[key]);
		expect(changed.map((key) => `${key}: ${before[key]} → ${after[key]}`)).toEqual([]);
		await light.context().close();
		await dark.context().close();
	});
}
