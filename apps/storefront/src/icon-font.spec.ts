import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The split icon font (scripts/split-icon-font.mjs): the shop's icons come from a small preloaded file, any other
 * icon from the vendor's full font. These checks fail when the generated files fall behind the vendor stylesheet or
 * the shop's templates; the fix is always to run the script again.
 */
const APP = resolve(__dirname, '..');
const vendor = readFileSync(join(APP, 'public/assets/css/remixicon.css'), 'utf8');
const shopCss = readFileSync(join(APP, 'public/assets/css/remixicon-shop.css'), 'utf8');
const FACE = /@font-face\s*\{[^}]*\}\s*/g;

function files(dir: string, keep: (name: string) => boolean): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path, keep);
		return keep(name) ? [path] : [];
	});
}

function points(range: string): Set<number> {
	const result = new Set<number>();
	for (const part of range.split(',')) {
		const [from = '', to] = part.trim().replace('U+', '').split('-');
		for (let point = parseInt(from, 16); point <= parseInt(to ?? from, 16); point++) result.add(point);
	}
	return result;
}

const faces = [...shopCss.matchAll(FACE)].map((match) => match[0]);
const rangeOf = (face: string | undefined) => points(/unicode-range:([^;]+);/.exec(face ?? '')?.[1] ?? '');
const shopFace = faces.find((face) => face.includes('remixicon-shop.woff'));
const fullFace = faces.find((face) => face.includes('remixicon.woff2'));
const icons = new Map(
	[...vendor.matchAll(/\.(ri-[a-z0-9-]+):before\s*\{\s*content:\s*['"]\\([0-9a-f]+)['"]/g)].map((match) => [
		match[1] ?? '',
		parseInt(match[2] ?? '', 16),
	]),
);

describe('split icon font', () => {
	it("is the vendor's stylesheet with only its @font-face replaced", () => {
		expect(faces).toHaveLength(2);
		const rules = (css: string) =>
			css
				.replace(/^\/\*[\s\S]*?\*\/\s*/, '')
				.replace(FACE, '')
				.replace(/^\/\*[\s\S]*?\*\/\s*/, '');
		expect(rules(shopCss)).toBe(rules(vendor));
	});

	it('gives every icon to exactly one file', () => {
		const shop = rangeOf(shopFace);
		const full = rangeOf(fullFace);
		expect([...shop].filter((point) => full.has(point))).toEqual([]);
		const all = new Set(icons.values());
		expect([...all].filter((point) => !shop.has(point) && !full.has(point))).toEqual([]);
	});

	it('has every icon the shop names in the small file', () => {
		const shop = rangeOf(shopFace);
		const sources = [
			...files(join(APP, 'src/app'), (name) => /\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts')),
			...files(join(APP, 'public/assets/data'), (name) => name.endsWith('.json')),
		];
		const missing = new Set<string>();
		for (const file of sources) {
			for (const name of readFileSync(file, 'utf8').match(/\bri-[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
				const point = icons.get(name);
				if (point !== undefined && !shop.has(point)) missing.add(name);
			}
		}
		// Not empty: run `node scripts/split-icon-font.mjs` and commit what it writes.
		expect([...missing]).toEqual([]);
	});

	it('is preloaded by index.html at the address the stylesheet names', () => {
		const file = /url\('\.\.(\/fonts\/remixicon\/remixicon-shop\.woff\?v=[0-9a-f]+)'\)/.exec(shopFace ?? '')?.[1];
		expect(file).toBeTruthy();
		const index = readFileSync(join(APP, 'index.html'), 'utf8');
		expect(index).toContain(`href="/assets${file}"`);
		expect(index).toContain('href="/assets/css/remixicon-shop.css"');
		expect(index).not.toContain('remixicon.woff2');
	});
});
