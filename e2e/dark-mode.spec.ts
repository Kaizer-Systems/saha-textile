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
	// Far sections are drawn only near the screen (content-visibility), so a section at the edge of that distance
	// may or may not be drawn yet at first and its height is then its placeholder's. Draw them all, as Back does,
	// so the two modes are compared on their real layout.
	await page.evaluate(() => document.documentElement.classList.add('st-render-all'));
	await page.waitForTimeout(500);
	// A carousel lays its slides out again when it starts (ngx-owl-carousel-o marks it owl-loaded); compare the two
	// modes only once every carousel on the page has, or one page is caught before and the other after (CI, 24 Nov).
	// An empty carousel takes no room and never starts.
	await page.waitForFunction(() =>
		[...document.querySelectorAll('owl-carousel-o')]
			.filter((host) => host.getBoundingClientRect().width > 0)
			.every((host) => host.querySelector('.owl-carousel')?.classList.contains('owl-loaded')),
	);
	// A page still reading (the cart from the server, a product's skeleton) keeps still while it waits, so the network
	// going quiet is not enough on a busy machine (CI, 26 Nov: one cart drawn, the other not yet): wait for its
	// placeholders to go and for the page to stop changing.
	await page
		.waitForFunction(() => !document.querySelector('.common-skeleton, [aria-busy="true"]'), undefined, {
			timeout: 20_000,
		})
		.catch(() => undefined);
	const shape = () =>
		page.evaluate(() => `${document.body.innerHTML.length}:${document.documentElement.scrollHeight}`);
	let before = await shape();
	for (let tries = 0; tries < 20; tries++) {
		await page.waitForTimeout(250);
		const now = await shape();
		if (now === before) break;
		before = now;
	}
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
