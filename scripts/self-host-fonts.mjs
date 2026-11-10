#!/usr/bin/env node
/**
 * Downloads the text fonts each app uses and writes the `@font-face` rules that serve them from the
 * app's own address, so no page waits on a second host before it can draw.
 *
 *   node scripts/self-host-fonts.mjs            # every app
 *   node scripts/self-host-fonts.mjs storefront # one app
 *
 * Run it only to add a font or take a newer release. It asks Google Fonts for the same stylesheet
 * a modern browser gets, keeps every face and language subset in it (nothing is trimmed), saves the
 * WOFF2 files under `public/<folder>/` with readable names, saves each family's licence beside them,
 * and writes the app's `fonts.css`. All the families are under the SIL Open Font License, which
 * allows serving them ourselves. Commit the fonts, the licences and `fonts.css` together.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** A current desktop Chrome, so Google answers with WOFF2 files and unicode-range subsets. */
const BROWSER =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const PUBLIC_SANS =
	'Public+Sans:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900';
const NOTO_SANS_BENGALI = 'Noto+Sans+Bengali:wght@400;600';

/** Licence folder of each family in github.com/google/fonts. */
const LICENCES = {
	'Public Sans': 'ofl/publicsans',
	'Noto Sans Bengali': 'ofl/notosansbengali',
	'Russo One': 'ofl/russoone',
	'Chakra Petch': 'ofl/chakrapetch',
	'IBM Plex Mono': 'ofl/ibmplexmono',
	'IBM Plex Sans': 'ofl/ibmplexsans',
	'IBM Plex Sans Condensed': 'ofl/ibmplexsanscondensed',
};

/**
 * `folder` is under the app's `public/` and is also the URL path; `css` is the file the app's global
 * stylesheet imports.
 */
const APPS = {
	storefront: {
		families: [PUBLIC_SANS, NOTO_SANS_BENGALI, 'Russo+One'],
		folder: 'assets/fonts/text',
		css: 'apps/storefront/src/fonts.css',
	},
	admin: {
		families: [PUBLIC_SANS, NOTO_SANS_BENGALI],
		folder: 'assets/fonts/text',
		css: 'apps/admin/src/fonts.css',
	},
	'release-console': {
		families: [
			'Chakra+Petch:wght@500;600;700',
			'IBM+Plex+Mono:wght@400;500',
			'IBM+Plex+Sans:wght@400;500;600',
			'IBM+Plex+Sans+Condensed:wght@500;600;700',
		],
		folder: 'fonts',
		css: 'apps/release-console/src/fonts.css',
	},
};

const slug = (text) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

async function text(url, headers = {}) {
	const response = await fetch(url, { headers });
	if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
	return response.text();
}

/** Every `@font-face` block with the subset named in the comment Google puts before it. */
function faces(css) {
	const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)];
	if (blocks.length === 0) throw new Error('Google Fonts sent no @font-face rules.');
	return blocks.map(([, subset, body]) => {
		const read = (property) => new RegExp(`${property}:\\s*([^;]+);`).exec(body)?.[1].trim();
		const url = /url\(([^)]+)\)/.exec(body)?.[1];
		const family = read('font-family')?.replace(/['"]/g, '');
		if (!url || !family) throw new Error(`An @font-face rule for ${subset} has no file or family.`);
		return {
			subset,
			family,
			style: read('font-style') ?? 'normal',
			weight: read('font-weight') ?? '400',
			range: read('unicode-range'),
			url,
		};
	});
}

async function selfHost(name, app) {
	const query = app.families.map((family) => `family=${family}`).join('&');
	const list = faces(
		await text(`https://fonts.googleapis.com/css2?${query}&display=swap`, { 'User-Agent': BROWSER }),
	);
	const folder = join(ROOT, 'apps', name, 'public', app.folder);
	rmSync(folder, { recursive: true, force: true });
	mkdirSync(folder, { recursive: true });

	// One file can serve several weights (a variable font), so the name carries the weight range.
	const files = new Map();
	for (const face of list) {
		const weights = list.filter((other) => other.url === face.url).map((other) => Number(other.weight));
		const low = Math.min(...weights);
		const high = Math.max(...weights);
		const weight = low === high ? `${low}` : `${low}-${high}`;
		files.set(face.url, `${slug(face.family)}-${face.style}-${weight}-${face.subset}.woff2`);
	}
	for (const [url, file] of files) {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
		writeFileSync(join(folder, file), Buffer.from(await response.arrayBuffer()));
	}
	for (const family of new Set(list.map((face) => face.family))) {
		const licence = await text(`https://raw.githubusercontent.com/google/fonts/main/${LICENCES[family]}/OFL.txt`);
		writeFileSync(join(folder, `${slug(family)}-OFL.txt`), licence);
	}

	const rules = list.map(
		(face) => `/* ${face.family}, ${face.subset} */
@font-face {
	font-family: '${face.family}';
	font-style: ${face.style};
	font-weight: ${face.weight};
	font-display: swap;
	src: url('/${app.folder}/${files.get(face.url)}') format('woff2');${face.range ? `\n\tunicode-range: ${face.range};` : ''}
}`,
	);
	writeFileSync(
		join(ROOT, app.css),
		`/*
 * Text fonts served from this app's own address. Written by scripts/self-host-fonts.mjs; do not
 * edit by hand. A browser downloads a file only when the page shows a character in its
 * unicode-range in that family and style, so unused faces and languages cost nothing.
 */
${rules.join('\n\n')}
`,
	);
	// The repository's own formatting, so the file passes `pnpm lint` as written.
	execFileSync('pnpm', ['exec', 'prettier', '--write', app.css], { cwd: ROOT, stdio: 'ignore' });
	console.log(`${name}: ${files.size} files, ${list.length} rules -> ${app.css}`);
	console.log(
		readdirSync(folder)
			.map((file) => `  ${file}`)
			.join('\n'),
	);
}

const only = process.argv[2];
if (only && !APPS[only]) throw new Error(`Unknown app ${only}. Known: ${Object.keys(APPS).join(', ')}.`);
for (const [name, app] of Object.entries(APPS)) {
	if (!only || only === name) await selfHost(name, app);
}
