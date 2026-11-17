#!/usr/bin/env node
/**
 * The speed gate (Page Builder SG-10): Lighthouse 12.6.1 on the shop's Home in English and বাংলা, on a 390 × 844 phone
 * and a 1440 × 900 computer, three runs each, compared by median with the brief's floor: Performance 97 or more,
 * Accessibility, Best Practices and SEO 100, layout shift 0.
 *
 *   node scripts/speed-gate.mjs https://localhost:4200            report only
 *   node scripts/speed-gate.mjs https://localhost:4200 --enforce  exit 1 below the floor
 *   SPEED_GATE_PAGES="en=/en/;bn=/bn/"                            other pages (label=path;…)
 *   SPEED_GATE_LAYOUTS=1                                          Home with each template and the stress layout,
 *                                                                 each made live in turn (apps/api speed:layouts)
 *   SPEED_GATE_FULL=1                                             the nightly table: every size upright and on its
 *                                                                 side, light and dark (SG-10)
 *   SPEED_GATE_LAYOUT_CASES=current,stress                        only these layouts (the nightly table)
 *   SPEED_GATE_RUNS=3                                             runs per row, compared by median
 *
 * The table goes to stdout and, in GitHub Actions, to the job summary. CI starts the stack with
 * `pnpm e2e:stack -- --speed`, which runs this against its production builds.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FLOOR } from './speed-floor.mjs';

export { FLOOR };
const RUNS = Math.max(1, Number(process.env.SPEED_GATE_RUNS ?? 3) || 3);
const QUICK_SIZES = [
	{ name: 'phone 390×844', width: 390, height: 844, ratio: 3, mobile: true },
	{ name: 'computer 1440×900', width: 1440, height: 900, ratio: 1, mobile: false },
];
/** The brief's full size table (SG-10): phones, tablets, laptops and large screens, upright and on their side. */
const FULL_BASE = [
	['phone', 360, 800, 3, true],
	['phone', 390, 844, 3, true],
	['phone', 430, 932, 3, true],
	['tablet', 768, 1024, 2, true],
	['tablet', 820, 1180, 2, true],
	['laptop', 1366, 768, 1, false],
	['laptop', 1440, 900, 2, false],
	['computer', 1920, 1080, 1, false],
	['large', 2560, 1440, 1, false],
	['large', 3840, 2160, 1, false],
];
const FULL_SIZES = FULL_BASE.flatMap(([kind, width, height, ratio, mobile]) =>
	[
		[width, height],
		[height, width],
	].map(([w, h]) => ({ name: `${kind} ${w}×${h}`, width: w, height: h, ratio, mobile })),
);
const full = process.env.SPEED_GATE_FULL === '1';
const SIZES = full ? FULL_SIZES : QUICK_SIZES;
const THEMES = full ? ['light', 'dark'] : ['light'];

const args = process.argv.slice(2);
const base = (args.find((arg) => !arg.startsWith('--')) ?? 'https://localhost:4200').replace(/\/$/, '');
const enforce = args.includes('--enforce');
const pages = (process.env.SPEED_GATE_PAGES ?? 'en=/en/;bn=/bn/').split(';').map((pair) => {
	const [label, path] = pair.split('=');
	return { label, path };
});

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const out = mkdtempSync(join(tmpdir(), 'speed-gate-'));

/** One Lighthouse run: the four scores and the layout shift. */
function measure(url, size, run, theme) {
	const file = join(out, `${size.width}x${size.height}-${theme}-${run}.json`);
	const lighthouse = [
		'dlx',
		'lighthouse@12.6.1',
		url,
		'--quiet',
		'--output=json',
		`--output-path=${file}`,
		'--chrome-flags=--headless=new --no-first-run --ignore-certificate-errors',
		`--screenEmulation.width=${size.width}`,
		`--screenEmulation.height=${size.height}`,
		`--screenEmulation.deviceScaleFactor=${size.ratio}`,
		`--screenEmulation.mobile=${size.mobile}`,
		`--formFactor=${size.mobile ? 'mobile' : 'desktop'}`,
		...(size.mobile ? [] : ['--preset=desktop']),
		// Dark mode is the shopper's switch, kept in the st_theme cookie.
		...(theme === 'dark' ? [`--extra-headers=${JSON.stringify({ Cookie: 'st_theme=dark' })}`] : []),
	];
	execFileSync('pnpm', lighthouse, { cwd: out, stdio: 'ignore', timeout: 240_000 });
	const report = JSON.parse(readFileSync(file, 'utf8'));
	const score = (id) => Math.round((report.categories[id]?.score ?? 0) * 100);
	return {
		performance: score('performance'),
		accessibility: score('accessibility'),
		bestPractices: score('best-practices'),
		seo: score('seo'),
		cls: report.audits['cumulative-layout-shift']?.numericValue ?? 1,
	};
}

/** The layouts to measure: Home as it is, or each template and the stress layout made live in turn. */
const only = (process.env.SPEED_GATE_LAYOUT_CASES ?? '').split(',').filter(Boolean);
const layouts =
	process.env.SPEED_GATE_LAYOUTS === '1'
		? layoutCases().filter((layout) => !only.length || only.includes(layout))
		: ['current'];

function layoutCases() {
	return execFileSync('pnpm', ['--filter', '@saha-textile/api', '--silent', 'speed:layouts', 'list'], {
		encoding: 'utf8',
	})
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

function makeLive(layout) {
	if (process.env.SPEED_GATE_LAYOUTS !== '1') return;
	execFileSync('pnpm', ['--filter', '@saha-textile/api', '--silent', 'speed:layouts', 'live', layout], {
		stdio: 'inherit',
	});
}

const rows = [];
for (const layout of layouts) {
	makeLive(layout);
	for (const page of pages) {
		for (const size of SIZES) {
			for (const theme of THEMES) {
				const runs = [];
				for (let run = 1; run <= RUNS; run += 1) runs.push(measure(`${base}${page.path}`, size, run, theme));
				const pick = (key) => median(runs.map((result) => result[key]));
				const row = {
					layout,
					theme,
					page: page.label,
					size: size.name,
					performance: pick('performance'),
					accessibility: pick('accessibility'),
					bestPractices: pick('bestPractices'),
					seo: pick('seo'),
					cls: pick('cls'),
				};
				row.passes =
					row.performance >= FLOOR.performance &&
					row.accessibility >= FLOOR.accessibility &&
					row.bestPractices >= FLOOR.bestPractices &&
					row.seo >= FLOOR.seo &&
					row.cls <= FLOOR.cls;
				rows.push(row);
			}
		}
	}
}

const table = [
	'| Layout | Page | Screen | Mode | Performance | Accessibility | Best Practices | SEO | Layout shift | Floor |',
	'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
	...rows.map(
		(row) =>
			`| ${row.layout} | ${row.page} | ${row.size} | ${row.theme} | ${row.performance} | ${row.accessibility} | ${row.bestPractices} | ${row.seo} | ${row.cls.toFixed(3)} | ${row.passes ? 'met' : 'below'} |`,
	),
].join('\n');
const failing = rows.filter((row) => !row.passes).length;
const verdict = failing
	? `${failing} of ${rows.length} below the floor (Performance ${FLOOR.performance}, the others 100, layout shift 0).`
	: 'Every page and screen meets the floor.';
const summary = `### Speed gate (Lighthouse 12.6.1, median of ${RUNS})\n\n${table}\n\n${verdict} ${enforce ? 'Enforced.' : 'Report only.'}\n`;
process.stdout.write(`${summary}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.exit(enforce && failing ? 1 : 0);
