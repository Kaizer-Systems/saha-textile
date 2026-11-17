#!/usr/bin/env node
/**
 * The speed gate (Page Builder SG-10): Lighthouse 12.6.1 on the shop's Home in English and বাংলা, on a 390 × 844 phone
 * and a 1440 × 900 computer, three runs each, compared by median with the brief's floor: Performance 97 or more,
 * Accessibility, Best Practices and SEO 100, layout shift 0.
 *
 *   node scripts/speed-gate.mjs https://localhost:4200            report only
 *   node scripts/speed-gate.mjs https://localhost:4200 --enforce  exit 1 below the floor
 *   SPEED_GATE_PAGES="en=/en/;bn=/bn/"                            other pages (label=path;…)
 *
 * The table goes to stdout and, in GitHub Actions, to the job summary. CI starts the stack with
 * `pnpm e2e:stack -- --speed`, which runs this against its production builds.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FLOOR = { performance: 97, accessibility: 100, bestPractices: 100, seo: 100, cls: 0 };
const RUNS = 3;
const SIZES = [
	{ name: 'phone 390×844', width: 390, height: 844, ratio: 3, mobile: true },
	{ name: 'computer 1440×900', width: 1440, height: 900, ratio: 1, mobile: false },
];

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
function measure(url, size, run) {
	const file = join(out, `${size.width}-${run}.json`);
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

const rows = [];
for (const page of pages) {
	for (const size of SIZES) {
		const runs = [];
		for (let run = 1; run <= RUNS; run += 1) runs.push(measure(`${base}${page.path}`, size, run));
		const pick = (key) => median(runs.map((result) => result[key]));
		const row = {
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

const table = [
	'| Page | Screen | Performance | Accessibility | Best Practices | SEO | Layout shift | Floor |',
	'| --- | --- | --- | --- | --- | --- | --- | --- |',
	...rows.map(
		(row) =>
			`| ${row.page} | ${row.size} | ${row.performance} | ${row.accessibility} | ${row.bestPractices} | ${row.seo} | ${row.cls.toFixed(3)} | ${row.passes ? 'met' : 'below'} |`,
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
