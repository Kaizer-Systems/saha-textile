#!/usr/bin/env node
/**
 * Writes the shop's metric-matched fallback faces (`apps/storefront/src/font-fallbacks.css`).
 *
 *   node scripts/font-fallback-metrics.mjs
 *
 * Until Public Sans has arrived, the browser draws text in the next font of the stack. A plain fallback is wider or
 * narrower and sits higher or lower, so the text moves when Public Sans swaps in (a layout shift). The fix Next.js
 * (`next/font`) and Nuxt (fontaine) apply: a fallback face over a font every computer has (Arial), scaled with
 * `size-adjust` to Public Sans' average letter width and given Public Sans' ascent, descent and line gap with the
 * `*-override` descriptors, so the fallback takes the same room.
 *
 * The numbers are measured here in Chromium, the way the browser itself reads the fonts: the shop's own Public Sans
 * files against the Arial installed on this computer, at four faces (regular and bold, upright and italic). Run it
 * on a Mac (Arial is a system font there) after taking a new Public Sans release with self-host-fonts.mjs, and
 * commit the result. The formulas follow Capsize, which Next.js uses: size-adjust = Public Sans' average width ÷
 * Arial's; each override = Public Sans' metric ÷ size-adjust (the browser scales overrides by size-adjust too).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';
import { format, resolveConfig } from 'prettier';

const ROOT = resolve(import.meta.dirname, '..');
const APP = resolve(ROOT, 'apps/storefront');
const OUT = resolve(APP, 'src/font-fallbacks.css');
const FAMILY = 'Public Sans';
const FALLBACK = 'Public Sans Fallback';

/**
 * Text the average width is taken over: the shop's own kind of English (menu words, product names, sentences), so
 * letters weigh as they do on its pages. Spaces and digits included, as on the page.
 */
const SAMPLE = [
	'Home Sarees Fabrics Collections Blog Contact Us Track Order Wishlist Cart Sign In My Account',
	'Handwoven Banarasi silk saree with zari border, Dhakai Jamdani in soft cotton, Tant sarees for everyday wear.',
	'New Arrivals Bestsellers On Sale Featured Products Recently Viewed Free shipping on orders above Rs 2,999.',
	'Every saree is checked by hand in our Kolkata store before it is packed and sent to you within 2 to 4 days.',
].join(' ');

/** The four faces: Public Sans weight and style, the Arial face it is matched to, and the weights it covers. */
const FACES = [
	{ weight: 400, style: 'normal', local: ['Arial', 'ArialMT'], range: '100 500' },
	{ weight: 700, style: 'normal', local: ['Arial Bold', 'Arial-BoldMT'], range: '600 900' },
	{ weight: 400, style: 'italic', local: ['Arial Italic', 'Arial-ItalicMT'], range: '100 500' },
	{ weight: 700, style: 'italic', local: ['Arial Bold Italic', 'Arial-BoldItalicMT'], range: '600 900' },
];

/** The unicode-range of Public Sans' Latin subsets in fonts.css, so the fallback never stands in for বাংলা letters. */
function latinRange() {
	const css = readFileSync(resolve(APP, 'src/fonts.css'), 'utf8');
	const ranges = new Set();
	for (const block of css.matchAll(/\/\* Public Sans, (latin|latin-ext) \*\/\s*@font-face\s*\{([^}]*)\}/g)) {
		const range = /unicode-range:([^;]+);/.exec(block[2] ?? '')?.[1];
		if (!range) continue;
		for (const part of range.split(',')) ranges.add(part.trim());
	}
	if (ranges.size === 0) throw new Error('No Public Sans latin faces found in src/fonts.css');
	return [...ranges].join(', ');
}

function fontFile(style, subset) {
	return readFileSync(resolve(APP, `public/assets/fonts/text/public-sans-${style}-100-900-${subset}.woff2`));
}

// Google Chrome, as the e2e tests use (playwright.config.ts), so no extra browser download is needed.
const browser = await chromium.launch({ channel: 'chrome' });
try {
	const page = await browser.newPage();
	await page.setContent('<!doctype html><html><body></body></html>');
	const measured = await page.evaluate(
		async ({ faces, sample, files }) => {
			const canvas = document.createElement('canvas').getContext('2d');
			if (!canvas) throw new Error('No canvas');
			const size = 1000;
			/** Average width per character, ascent, descent and line gap, in units of the font size. */
			const read = (family, weight, style) => {
				canvas.font = `${style} ${weight} ${size}px "${family}"`;
				const text = canvas.measureText(sample);
				const box = canvas.measureText('Hxg');
				const probe = document.createElement('div');
				probe.style.cssText = `position:absolute;white-space:nowrap;line-height:normal;font:${style} ${weight} ${size}px "${family}"`;
				probe.textContent = 'Hxg';
				document.body.append(probe);
				const lineHeight = probe.getBoundingClientRect().height;
				probe.remove();
				const ascent = box.fontBoundingBoxAscent / size;
				const descent = box.fontBoundingBoxDescent / size;
				return {
					width: text.width / sample.length / size,
					ascent,
					descent,
					lineGap: Math.max(0, lineHeight / size - ascent - descent),
				};
			};
			const results = [];
			for (const face of faces) {
				const target = new FontFace('Measure Target', `url(data:font/woff2;base64,${files[face.style]})`, {
					weight: String(face.weight),
					style: face.style,
				});
				document.fonts.add(await target.load());
				const fallback = new FontFace(
					'Measure Fallback',
					face.local.map((name) => `local("${name}")`).join(', '),
					{
						weight: String(face.weight),
						style: face.style,
					},
				);
				document.fonts.add(await fallback.load());
				results.push({
					target: read('Measure Target', face.weight, face.style),
					fallback: read('Measure Fallback', face.weight, face.style),
				});
				document.fonts.delete(target);
				document.fonts.delete(fallback);
			}
			return results;
		},
		{
			faces: FACES,
			sample: SAMPLE,
			files: {
				normal: fontFile('normal', 'latin').toString('base64'),
				italic: fontFile('italic', 'latin').toString('base64'),
			},
		},
	);

	const percent = (value) => `${(value * 100).toFixed(2)}%`;
	const range = latinRange();
	const rules = FACES.map((face, index) => {
		const { target, fallback } = measured[index] ?? {};
		if (!target || !fallback) throw new Error('A face was not measured');
		const sizeAdjust = target.width / fallback.width;
		return [
			`/* ${FAMILY} ${face.weight}${face.style === 'italic' ? ' italic' : ''} over ${face.local[0]} */`,
			'@font-face {',
			`\tfont-family: '${FALLBACK}';`,
			`\tfont-style: ${face.style};`,
			`\tfont-weight: ${face.range};`,
			`\tsrc: ${face.local.map((name) => `local('${name}')`).join(', ')};`,
			`\tsize-adjust: ${percent(sizeAdjust)};`,
			`\tascent-override: ${percent(target.ascent / sizeAdjust)};`,
			`\tdescent-override: ${percent(target.descent / sizeAdjust)};`,
			`\tline-gap-override: ${percent(target.lineGap / sizeAdjust)};`,
			`\tunicode-range: ${range};`,
			'}',
		].join('\n');
	});

	const header = [
		'/*',
		` * Metric-matched fallback for ${FAMILY}. Written by scripts/font-fallback-metrics.mjs; do not edit by hand.`,
		' * While Public Sans is still on its way, text is drawn in Arial scaled and spaced to take the same room, so',
		' * nothing moves when Public Sans swaps in. Latin letters only: বাংলা text goes on to Noto Sans Bengali.',
		' */',
	].join('\n');
	const css = `${header}\n${rules.join('\n\n')}\n`;
	writeFileSync(OUT, await format(css, { ...(await resolveConfig(OUT)), filepath: OUT }));
	console.log(`Wrote ${OUT}`);
	for (const [index, face] of FACES.entries()) {
		const { target, fallback } = measured[index];
		console.log(
			`${face.weight} ${face.style}: width ${target.width.toFixed(4)} vs ${fallback.width.toFixed(4)}, ` +
				`ascent ${target.ascent.toFixed(3)}, descent ${target.descent.toFixed(3)}, gap ${target.lineGap.toFixed(3)}`,
		);
	}
} finally {
	await browser.close();
}
