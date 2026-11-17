#!/usr/bin/env node
/**
 * Splits the shop's icon font so a page downloads only the icons the shop uses.
 *
 *   node scripts/split-icon-font.mjs        (needs HarfBuzz's hb-subset: `brew install harfbuzz`)
 *
 * Remix Icon is one 141 KB font of about 2,500 icons, and every page preloaded all of it at high priority, competing
 * with the page's first picture on a phone. The shop's templates use about a hundred. This is the unicode-range
 * technique Google Fonts uses for large fonts: the same font family is declared twice, each declaration covering
 * different characters, and a browser downloads a file only when the page shows one of its characters.
 *
 *   - remixicon-shop.woff: the icons the shop names (templates, code, demo data) and the code points the theme's
 *     own styles draw. About 9 KB; index.html preloads it.
 *   - every other icon: the vendor's own remixicon.woff2, unchanged, declared for the other characters only, so it
 *     is fetched only if a page ever shows one of them. Nothing is removed; every icon still works.
 *
 * It writes public/assets/fonts/remixicon/remixicon-shop.woff and public/assets/css/remixicon-shop.css (the
 * vendor's remixicon.css with only its @font-face replaced; every icon rule is the vendor's, byte for byte), and
 * points index.html's preload at the new file. The vendor files stay as they are. Run it after adding an icon to a
 * template (src/icon-font.spec.ts fails until then) and commit the three files together.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import { format, resolveConfig } from 'prettier';

const APP = resolve(import.meta.dirname, '../apps/storefront');
const VENDOR_CSS = join(APP, 'public/assets/css/remixicon.css');
const SHOP_CSS = join(APP, 'public/assets/css/remixicon-shop.css');
const FONT_DIR = join(APP, 'public/assets/fonts/remixicon');
const INDEX = join(APP, 'index.html');

/** Every file below `dir` whose name passes `keep`. */
function files(dir, keep) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path, keep);
		return keep(name) ? [path] : [];
	});
}

/** Icon class name → code point (hex), from the vendor stylesheet. */
function iconCodePoints(css) {
	const map = new Map();
	for (const match of css.matchAll(/\.(ri-[a-z0-9-]+):before\s*\{\s*content:\s*['"]\\([0-9a-f]+)['"]/g)) {
		map.set(match[1], match[2]);
	}
	return map;
}

/** The code points the shop draws: icon classes it names, and private-use code points in the theme's styles. */
function shopCodePoints(icons) {
	const used = new Set();
	const sources = [
		...files(join(APP, 'src/app'), (name) => /\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts')),
		...files(join(APP, 'public/assets/data'), (name) => name.endsWith('.json')),
	];
	for (const file of sources) {
		for (const name of readFileSync(file, 'utf8').match(/\bri-[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
			const point = icons.get(name);
			if (point) used.add(point);
		}
	}
	const all = new Set(icons.values());
	for (const file of files(join(APP, 'src/scss'), (name) => name.endsWith('.scss'))) {
		for (const match of readFileSync(file, 'utf8').matchAll(/content:\s*['"]\\([ef][0-9a-f]{3})['"]/gi)) {
			const point = (match[1] ?? '').toLowerCase();
			if (all.has(point)) used.add(point);
		}
	}
	return [...used].sort();
}

/** Code points as a CSS unicode-range, with runs folded into ranges. */
function unicodeRange(points) {
	const numbers = [...new Set(points.map((point) => parseInt(point, 16)))].sort((a, b) => a - b);
	const parts = [];
	for (let index = 0; index < numbers.length;) {
		let end = index;
		while (end + 1 < numbers.length && numbers[end + 1] === numbers[end] + 1) end++;
		const from = numbers[index].toString(16).toUpperCase();
		const to = numbers[end].toString(16).toUpperCase();
		parts.push(end === index ? `U+${from}` : `U+${from}-${to}`);
		index = end + 1;
	}
	return parts.join(', ');
}

/**
 * A TrueType font as WOFF 1.0: each table deflated (zlib) when that makes it smaller, tables in tag order on 4-byte
 * boundaries, the original checksums kept. Every browser reads it; no compressor beyond Node's zlib is needed.
 */
function toWoff(sfnt) {
	const count = sfnt.readUInt16BE(4);
	const tables = [];
	for (let index = 0; index < count; index++) {
		const at = 12 + 16 * index;
		tables.push({
			tag: sfnt.toString('latin1', at, at + 4),
			checksum: sfnt.readUInt32BE(at + 4),
			offset: sfnt.readUInt32BE(at + 8),
			length: sfnt.readUInt32BE(at + 12),
		});
	}
	tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
	const directory = Buffer.alloc(20 * count);
	const bodies = [];
	let offset = 44 + directory.length;
	let sfntSize = 12 + 16 * count;
	tables.forEach((table, index) => {
		const data = sfnt.subarray(table.offset, table.offset + table.length);
		const packed = deflateSync(data, { level: 9 });
		const stored = packed.length < data.length ? packed : data;
		const at = 20 * index;
		directory.write(table.tag, at, 'latin1');
		directory.writeUInt32BE(offset, at + 4);
		directory.writeUInt32BE(stored.length, at + 8);
		directory.writeUInt32BE(table.length, at + 12);
		directory.writeUInt32BE(table.checksum, at + 16);
		const body = Buffer.concat([stored, Buffer.alloc((4 - (stored.length % 4)) % 4)]);
		bodies.push(body);
		offset += body.length;
		sfntSize += (table.length + 3) & ~3;
	});
	const header = Buffer.alloc(44);
	header.write('wOFF', 0, 'latin1');
	header.writeUInt32BE(sfnt.readUInt32BE(0), 4);
	header.writeUInt32BE(offset, 8);
	header.writeUInt16BE(count, 12);
	header.writeUInt32BE(sfntSize, 16);
	header.writeUInt16BE(1, 20);
	return Buffer.concat([header, directory, ...bodies]);
}

const vendor = readFileSync(VENDOR_CSS, 'utf8');
const icons = iconCodePoints(vendor);
const shop = shopCodePoints(icons);
const rest = [...new Set(icons.values())].filter((point) => !shop.includes(point));

const work = mkdtempSync(join(tmpdir(), 'icon-font-'));
try {
	const subset = join(work, 'shop.ttf');
	execFileSync('hb-subset', [
		join(FONT_DIR, 'remixicon.ttf'),
		`--unicodes=${shop.map((point) => `U+${point}`).join(',')}`,
		`--output-file=${subset}`,
	]);
	const woff = toWoff(readFileSync(subset));
	writeFileSync(join(FONT_DIR, 'remixicon-shop.woff'), woff);
	const version = createHash('sha256').update(woff).digest('hex').slice(0, 8);
	const shopHref = `/assets/fonts/remixicon/remixicon-shop.woff?v=${version}`;

	const vendorFace = /@font-face\s*\{[^}]*\}\s*/.exec(vendor);
	if (!vendorFace) throw new Error('No @font-face in remixicon.css');
	const fullFont = /url\('([^']*remixicon\.woff2[^']*)'\)/.exec(vendorFace[0])?.[1];
	if (!fullFont) throw new Error('No woff2 in the vendor @font-face');
	const faces = [
		'/*',
		' * Remix Icon for the shop. Written by scripts/split-icon-font.mjs from remixicon.css; do not edit by hand.',
		' * Every rule after the two @font-face rules is the vendor file, unchanged. Only how the font loads differs:',
		` * the ${shop.length} icons the shop uses come from remixicon-shop.woff (${(woff.length / 1024).toFixed(1)} KB, preloaded by index.html);`,
		' * any other icon comes from the vendor font, which a page downloads only if it shows one of them.',
		' */',
		'@font-face {',
		"\tfont-family: 'remixicon';",
		`\tsrc: url('${fullFont}') format('woff2');`,
		'\tfont-display: swap;',
		`\tunicode-range: ${unicodeRange(rest)};`,
		'}',
		'@font-face {',
		"\tfont-family: 'remixicon';",
		`\tsrc: url('../fonts/remixicon/remixicon-shop.woff?v=${version}') format('woff');`,
		'\tfont-display: swap;',
		`\tunicode-range: ${unicodeRange(shop)};`,
		'}',
		'',
	].join('\n');
	const css = vendor.replace(vendorFace[0], faces);
	writeFileSync(SHOP_CSS, await format(css, { ...(await resolveConfig(SHOP_CSS)), filepath: SHOP_CSS }));

	const index = readFileSync(INDEX, 'utf8');
	const pointed = index.replace(/\/assets\/fonts\/remixicon\/remixicon-shop\.woff\?v=[0-9a-f]+/, shopHref);
	if (!pointed.includes(shopHref)) throw new Error('index.html does not preload remixicon-shop.woff');
	writeFileSync(INDEX, pointed);

	console.log(
		`${shop.length} shop icons -> remixicon-shop.woff (${woff.length} bytes), ${rest.length} others stay in remixicon.woff2`,
	);
} finally {
	rmSync(work, { recursive: true, force: true });
}
