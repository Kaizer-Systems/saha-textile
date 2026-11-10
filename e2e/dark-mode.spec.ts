import { expect, test, type Browser, type Page } from '@playwright/test';

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

interface LowContrast {
	text: string;
	ratio: number;
	color: string;
	background: string;
}

/** Runs in the page. Kept self-contained: Playwright serialises it. */
function lowContrast(): LowContrast[] {
	type Rgba = [number, number, number, number];
	// Reads rgb()/rgba() and color(srgb r g b), which is what color-mix() computes to.
	const rgbOf = (colour: string): Rgba | null => {
		const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(colour);
		if (srgb) {
			return [
				Number(srgb[1]) * 255,
				Number(srgb[2]) * 255,
				Number(srgb[3]) * 255,
				srgb[4] === undefined ? 1 : Number(srgb[4]),
			];
		}
		const parts = colour.match(/[\d.]+/g);
		if (!parts) return null;
		const [r = 0, g = 0, b = 0, a = 1] = parts.map(Number);
		return [r, g, b, a];
	};
	const luminance = ([r, g, b]: Rgba): number =>
		[r, g, b]
			.map((channel) => {
				const value = channel / 255;
				return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
			})
			.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
	// The colours behind an element: its first solid background, or every stop of a gradient.
	const backgroundsOf = (element: Element): Rgba[] | 'picture' => {
		for (let node: Element | null = element; node; node = node.parentElement) {
			const style = getComputedStyle(node);
			if (style.backgroundImage !== 'none') {
				if (!style.backgroundImage.includes('gradient')) return 'picture';
				const stops = (style.backgroundImage.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g) ?? [])
					.map(rgbOf)
					.filter((stop): stop is Rgba => !!stop && stop[3] > 0.9);
				if (stops.length) return stops;
			}
			const solid = rgbOf(style.backgroundColor);
			if (solid && solid[3] > 0.9) return [solid];
		}
		return [rgbOf(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1]];
	};
	const overPicture = (element: Element): boolean => {
		const box = element.getBoundingClientRect();
		if (box.bottom < 0 || box.top > innerHeight) return false;
		return document
			.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
			.some((under) => under instanceof HTMLImageElement || under instanceof HTMLVideoElement);
	};
	const found: LowContrast[] = [];
	const seen = new Set<Element>();
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode;
		const element = node.parentElement;
		const text = node.textContent ?? '';
		if (!element || seen.has(element) || !text.trim()) continue;
		seen.add(element);
		const box = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		if (box.width < 2 || box.height < 2 || style.visibility === 'hidden' || Number(style.opacity) < 0.3) continue;
		if (parseFloat(style.fontSize) < 1) continue;
		if (
			element.closest(
				'[aria-hidden="true"], .d-none, script, style, noscript, svg, img, picture, [disabled], .disabled',
			)
		)
			continue;
		// Banner text sits on photographs, the same in both modes; rating stars are decorative glyphs.
		if (element.closest('.home-contain, .banner-contain') || /^[★☆\s]+$/.test(text)) continue;
		const backgrounds = backgroundsOf(element);
		if (backgrounds === 'picture' || overPicture(element)) continue;
		const colour = rgbOf(style.color);
		if (!colour) continue;
		const foreground = luminance(colour);
		const ratio = Math.min(
			...backgrounds.map((background) => {
				const behind = luminance(background);
				return (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05);
			}),
		);
		const size = parseFloat(style.fontSize);
		const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
		if (ratio < (large ? 3 : 4.5)) {
			found.push({
				text: text.trim().slice(0, 40),
				ratio: Math.round(ratio * 100) / 100,
				color: style.color,
				background: backgrounds
					.map((background) => `rgb(${background.slice(0, 3).map(Math.round).join(', ')})`)
					.join(' → '),
			});
		}
	}
	return found;
}

/** Runs in the page: the box and type of every visible element on the first screen. */
function firstScreen(): Record<string, string> {
	const out: Record<string, string> = {};
	const path = (element: Element): string => {
		const parts: string[] = [];
		for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
			let index = 1;
			for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++;
			parts.unshift(`${node.tagName.toLowerCase()}:${index}`);
		}
		return parts.join('>');
	};
	for (const element of document.body.querySelectorAll('*')) {
		if (element.closest('script, style, noscript, svg, .cookie-bar-box, .toast-container')) continue;
		const box = element.getBoundingClientRect();
		if (box.width < 1 || box.height < 1 || box.top > innerHeight) continue;
		const style = getComputedStyle(element);
		out[path(element)] =
			`${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}|` +
			`${style.fontSize}|${style.fontWeight}|${style.padding}|${style.margin}`;
	}
	return out;
}

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
			expect(await page.evaluate(lowContrast), `${mode} mode`).toEqual([]);
			await page.context().close();
		}
	});

	test(`${path} has the same layout in light and dark mode`, async ({ browser, viewport }) => {
		const light = await open(browser, 'light', path, viewport);
		const dark = await open(browser, 'dark', path, viewport);
		const [before, after] = await Promise.all([light.evaluate(firstScreen), dark.evaluate(firstScreen)]);
		const changed = Object.keys(before).filter((key) => key in after && before[key] !== after[key]);
		expect(changed.map((key) => `${key}: ${before[key]} → ${after[key]}`)).toEqual([]);
		await light.context().close();
		await dark.context().close();
	});
}
