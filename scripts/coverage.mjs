#!/usr/bin/env node
/**
 * Test coverage of the application code. Every workspace must reach COVERAGE_FLOOR on statements,
 * branches, functions and lines, and its tests must pass. The goal is 100; the floor is lower for now
 * (see COVERAGE_FLOOR). Every file below 100% is listed either way, so a chat can check the files it
 * changed (AGENTS.md §5: every change keeps its own code at 100%).
 *
 *   pnpm coverage                  every workspace
 *   pnpm coverage -- api contracts just those
 *
 * Vitest silently drops Angular files that no spec imports, so a plain run reads high. For the
 * Angular apps this writes a temporary spec importing every source file (all but specs, type
 * declarations, test setup, the main entry points, server code, the service worker and `interfaces/`),
 * then deletes it.
 * Any file Vitest still refuses to parse fails the run, so the count cannot shrink quietly.
 *
 * The Mongo adapter suite needs the replica set: `pnpm mongo:up`. It runs on `saha_textile_it`.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { localMongoTarget, testDatabaseUri } from './secrets/test-login.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const METRICS = ['statements', 'branches', 'functions', 'lines'];
/**
 * The share (in %) of each metric every workspace must reach. The goal is 100. Lowered to 50 on 24 Nov 2026
 * (owner: "temporarily just drop it to 50% ... later when we have completed all of the test cases ... we'll
 * just put it back to 100 again"), so the staging deployment can go ahead while the backlog is tested.
 */
const COVERAGE_FLOOR = 50;
const DENOMINATOR = 'src/zz-denominator.spec.ts';

const WORKSPACES = {
	storefront: { dir: 'apps/storefront', angular: true },
	// The dark-theme spec reads the generated dark stylesheet, which only `styles` (run by the admin's
	// dev and build scripts) makes; a fresh checkout such as CI's coverage job has none.
	admin: {
		dir: 'apps/admin',
		angular: true,
		generated: { file: 'public/assets/css/theme-dark.gen.css', script: 'styles' },
	},
	api: { dir: 'apps/api' },
	'release-console': { dir: 'apps/release-console', angular: true },
	'release-console-api': { dir: 'apps/release-console-api' },
	'adapters-db-mongo': { dir: 'packages/adapters-db-mongo', mongo: true },
	'core-domain': { dir: 'packages/core-domain' },
	contracts: { dir: 'packages/contracts' },
	'http-transport': { dir: 'packages/http-transport' },
	'adapters-notifications-msg91': { dir: 'packages/adapters-notifications-msg91' },
	'adapters-storage-spaces': { dir: 'packages/adapters-storage-spaces' },
	'adapters-auth': { dir: 'packages/adapters-auth' },
	'adapters-queue-bullmq': { dir: 'packages/adapters-queue-bullmq' },
	'adapters-image-sharp': { dir: 'packages/adapters-image-sharp' },
	'adapters-youtube': { dir: 'packages/adapters-youtube' },
	'adapters-payments': { dir: 'packages/adapters-payments' },
	'adapters-cdn-cloudflare': { dir: 'packages/adapters-cdn-cloudflare' },
	'adapters-archive-zip': { dir: 'packages/adapters-archive-zip' },
	'adapters-fx': { dir: 'packages/adapters-fx' },
	'adapters-geo': { dir: 'packages/adapters-geo' },
	'adapters-gst-edocs': { dir: 'packages/adapters-gst-edocs' },
	'adapters-mail-gmail': { dir: 'packages/adapters-mail-gmail' },
	'adapters-pdf-chromium': { dir: 'packages/adapters-pdf-chromium' },
	'email-templates': { dir: 'packages/email-templates' },
	'release-console-contracts': { dir: 'packages/release-console-contracts' },
};

const envFile = join(ROOT, 'apps/api/.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function writeDenominator(cwd) {
	const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard', 'src'], { cwd, encoding: 'utf8' });
	const imports = listed.stdout
		.split('\n')
		.filter((file) => /\.ts$/.test(file))
		.filter(
			(file) =>
				!/\.spec\.ts$|\.d\.ts$|test-setup|main\.ts$|main\.server|\/server\/|service-worker\/|interfaces\//.test(
					file,
				),
		)
		.filter((file) => existsSync(join(cwd, file)))
		.map((file) => `import './${file.replace(/^src\//, '').replace(/\.ts$/, '')}';`);
	writeFileSync(
		join(cwd, DENOMINATOR),
		`${imports.join('\n')}\nimport { it } from 'vitest';\nit('loads', () => {});\n`,
	);
}

function measure(name, { dir, angular, mongo, generated }) {
	const cwd = join(ROOT, dir);
	const report = join(ROOT, 'coverage', name);
	const args = [
		'exec',
		'vitest',
		'run',
		'--coverage.enabled',
		'--coverage.reportOnFailure',
		'--coverage.provider=v8',
		'--coverage.include=src/**',
		'--coverage.exclude=**/*.d.ts',
		'--coverage.exclude=**/*.spec.ts',
		'--coverage.reporter=json-summary',
		'--coverage.reporter=json',
		`--coverage.reportsDirectory=${report}`,
	];
	// Where the suite's MongoDB is: CI's environment, else this Mac's apps/api/.env (port 27018).
	const target = mongo ? localMongoTarget('saha_textile_it') : null;
	const env = {
		...process.env,
		...(target
			? {
					RUN_DB_IT: '1',
					MONGODB_HOST: target.host || '127.0.0.1',
					MONGODB_DB_NAME: 'saha_textile_it',
					// The shop's own database login (apps/api/.env) reaches only its own database. The suite's
					// databases are reached with this Mac's test login, when there is one.
					MONGODB_URI: testDatabaseUri(target),
					MONGODB_USERNAME: '',
					MONGODB_PASSWORD: '',
					MONGODB_REPLICA_SET: target.replicaSet || 'rs0',
				}
			: {}),
	};
	if (generated && !existsSync(join(cwd, generated.file))) {
		const made = spawnSync('pnpm', ['run', generated.script], { cwd, encoding: 'utf8' });
		if (made.status !== 0)
			console.log(`${name}: pnpm run ${generated.script} failed, so ${generated.file} is missing.`);
	}
	if (angular) writeDenominator(cwd);
	let run;
	try {
		run = spawnSync('pnpm', args, { cwd, env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 });
	} finally {
		if (angular) rmSync(join(cwd, DENOMINATOR), { force: true });
	}
	const output = `${run.stdout}${run.stderr}`;
	const dropped = (output.match(/Failed to parse .*\.ts\. /g) ?? []).length;
	const summary = join(report, 'coverage-summary.json');
	const detail = existsSync(summary) ? JSON.parse(readFileSync(summary, 'utf8')) : null;
	const total = detail?.total;
	const percents = METRICS.map((metric) => total?.[metric]?.pct ?? 0);
	// Tests passed, nothing was dropped from the count and something was measured.
	const complete = run.status === 0 && dropped === 0 && total?.statements?.total > 0;
	const ok = complete && percents.every((percent) => percent >= COVERAGE_FLOOR);
	const full = complete && METRICS.every((metric) => total[metric]?.covered === total[metric]?.total);
	const line = `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} ${METRICS.map((metric, index) => `${metric[0]} ${percents[index]}%`).join('  ')}  (${total?.statements?.total ?? 0} statements)`;
	console.log(line);
	if (!full) {
		if (run.status !== 0)
			console.log(
				output
					.split('\n')
					.filter((line) => /FAIL|Error:/.test(line))
					.slice(0, 12)
					.join('\n'),
			);
		if (dropped) console.log(`      ${dropped} source files were dropped from the count`);
		const reportFile = join(report, 'coverage-final.json');
		if (detail && existsSync(reportFile)) {
			const sourceCoverage = JSON.parse(readFileSync(reportFile, 'utf8'));
			for (const [file, values] of Object.entries(detail)) {
				if (file !== 'total' && METRICS.some((metric) => values[metric].pct !== 100)) {
					console.log(
						`      ${file.replace(`${ROOT}/`, '')}  ${METRICS.map((m) => `${m[0]} ${values[m].pct}`).join(' ')}`,
					);
					if (sourceCoverage[file])
						console.log(`        lines ${missedLines(sourceCoverage[file]).join(', ')}`);
				}
			}
		}
	}
	return { ok, full, line };
}

/** Where a file lost its statements and branches, so a CI failure names the line. */
function missedLines(entry) {
	const statements = Object.entries(entry.s).filter(([, hits]) => hits === 0);
	const branches = Object.entries(entry.b).filter(([, hits]) => hits.includes(0));
	const lines = [
		...statements.map(([id]) => entry.statementMap[id].start.line),
		...branches.map(([id]) => entry.branchMap[id].loc.start.line),
	];
	return [...new Set(lines)].sort((a, b) => a - b);
}

const wanted = process.argv.slice(2).filter((arg) => arg !== '--');
const names = wanted.length ? wanted : Object.keys(WORKSPACES);
const unknown = names.filter((name) => !WORKSPACES[name]);
if (unknown.length) {
	console.error(`Unknown workspace: ${unknown.join(', ')}`);
	process.exit(2);
}

const results = names.map((name) => ({ name, ...measure(name, WORKSPACES[name]) }));
const failed = results.filter((result) => !result.ok).length;
const short = results.filter((result) => !result.full).length;
const verdict = [
	failed
		? `${failed} workspace(s) below the ${COVERAGE_FLOOR}% floor or failing their tests.`
		: `Every workspace reaches the ${COVERAGE_FLOOR}% floor and passes its tests.`,
	short ? `${short} workspace(s) not yet at 100%.` : 'All workspaces at 100%.',
].join(' ');
console.log(`\n${verdict}`);
if (process.env.GITHUB_STEP_SUMMARY)
	appendFileSync(
		process.env.GITHUB_STEP_SUMMARY,
		`### Test coverage (floor ${COVERAGE_FLOOR}%)\n\n\`\`\`\n${results.map((result) => result.line).join('\n')}\n\`\`\`\n\n${verdict}\n`,
	);
process.exit(failed ? 1 : 0);
