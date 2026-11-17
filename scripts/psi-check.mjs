#!/usr/bin/env node
/**
 * PageSpeed Insights before a release (Page Builder SG-10): Google's own run on the real domain, phone and computer,
 * for each address given, with the same floor as the speed gate (Performance 97, the others 100, layout shift 0).
 *
 *   node scripts/psi-check.mjs https://staging.example/en/ https://staging.example/bn/
 *   node scripts/psi-check.mjs --enforce <url>…        exit 1 below the floor
 *
 * PSI_API_KEY (optional) raises Google's rate limit. The table goes to stdout and, in GitHub Actions, to the job
 * summary. Field data (real shoppers) is shown when Google has it for the address.
 */
import { appendFileSync } from 'node:fs';

import { FLOOR } from './speed-floor.mjs';

const args = process.argv.slice(2);
const enforce = args.includes('--enforce');
const urls = args.filter((arg) => !arg.startsWith('--'));
if (!urls.length) {
	process.stderr.write('Usage: psi-check.mjs [--enforce] <url>…\n');
	process.exit(2);
}

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

async function run(url, strategy) {
	const query = new URLSearchParams({ url, strategy });
	for (const category of CATEGORIES) query.append('category', category);
	if (process.env.PSI_API_KEY) query.set('key', process.env.PSI_API_KEY);
	const response = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${query}`, {
		signal: AbortSignal.timeout(120_000),
	});
	if (!response.ok) throw new Error(`PageSpeed Insights answered ${response.status} for ${url} (${strategy})`);
	const body = await response.json();
	const lighthouse = body.lighthouseResult;
	const score = (id) => Math.round((lighthouse.categories[id]?.score ?? 0) * 100);
	const field = body.loadingExperience?.overall_category ?? 'no field data';
	return {
		url,
		strategy,
		performance: score('performance'),
		accessibility: score('accessibility'),
		bestPractices: score('best-practices'),
		seo: score('seo'),
		cls: lighthouse.audits['cumulative-layout-shift']?.numericValue ?? 1,
		field,
	};
}

const rows = [];
for (const url of urls) {
	for (const strategy of ['mobile', 'desktop']) {
		const row = await run(url, strategy);
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
	'| Address | Screen | Performance | Accessibility | Best Practices | SEO | Layout shift | Real shoppers | Floor |',
	'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
	...rows.map(
		(row) =>
			`| ${row.url} | ${row.strategy === 'mobile' ? 'phone' : 'computer'} | ${row.performance} | ${row.accessibility} | ${row.bestPractices} | ${row.seo} | ${row.cls.toFixed(3)} | ${row.field} | ${row.passes ? 'met' : 'below'} |`,
	),
].join('\n');
const failing = rows.filter((row) => !row.passes).length;
const summary = `### PageSpeed Insights\n\n${table}\n\n${failing ? `${failing} of ${rows.length} below the floor.` : 'Every address meets the floor.'} ${enforce ? 'Enforced.' : 'Report only.'}\n`;
process.stdout.write(`${summary}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.exit(enforce && failing ? 1 : 0);
